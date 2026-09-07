import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeAttachments } from "./nocodb.mjs";

const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function promptHtml(value) {
  if (!value) return "";
  return `<div class="prompt">${escapeHtml(value).replaceAll("\n", "<br>\n")}</div>`;
}

function safeFilename(value, fallback) {
  const basename = path.basename(String(value || fallback)).normalize("NFKC");
  const cleaned = basename
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "-")
    .replace(/^\.+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, 120);
}

function guessMime(filename) {
  const extension = path.extname(filename).toLowerCase();
  const known = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
    ".webp": "image/webp", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
    ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp4": "video/mp4", ".webm": "video/webm",
    ".mov": "video/quicktime"
  };
  return known[extension] || "application/octet-stream";
}

function mediaMarkup(media) {
  const src = `media/${encodeURIComponent(media.filename)}`;
  const label = escapeHtml(media.originalName);
  if (media.mime.startsWith("image/")) {
    return `<figure><img src="${src}" alt="${label}" loading="lazy"></figure>`;
  }
  if (media.mime.startsWith("audio/")) {
    return `<figure><audio controls preload="metadata" src="${src}">浏览器无法播放该音频。</audio></figure>`;
  }
  if (media.mime.startsWith("video/")) {
    return `<figure><video controls preload="metadata" playsinline src="${src}">浏览器无法播放该视频。</video></figure>`;
  }
  return `<p class="attachment"><a href="${src}" download>${label}</a></p>`;
}

export function makePublicKey() {
  return crypto.randomBytes(9).toString("base64url");
}

export function preparePages(records, settings, keyFactory = makePublicKey) {
  const pages = [];
  const patches = [];
  const usedKeys = new Set();

  for (const record of records) {
    const fields = record?.fields || record || {};
    const episode = text(fields[settings.fields.episode]);
    const name = text(fields[settings.fields.name]);
    const prompt = text(fields[settings.fields.prompt]);
    const attachments = normalizeAttachments(fields[settings.fields.media]);

    if (!episode && !name && !prompt && attachments.length === 0) continue;
    if (!record?.id && record?.id !== 0) throw new Error("NocoDB 记录缺少 id");
    if (!episode) throw new Error(`记录 ${record.id} 缺少“${settings.fields.episode}”`);
    if (!name) throw new Error(`记录 ${record.id} 缺少“${settings.fields.name}”`);
    if (!prompt && attachments.length === 0) {
      throw new Error(`记录 ${record.id} 至少需要提示词或多媒体`);
    }

    const rawDelay = fields[settings.fields.delay];
    const delaySeconds = rawDelay === null || rawDelay === undefined || rawDelay === ""
      ? settings.defaultDelaySeconds
      : Number(rawDelay);
    if (!Number.isSafeInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > 86400) {
      throw new Error(`记录 ${record.id} 的“${settings.fields.delay}”必须是 0–86400 的整数`);
    }

    let publicKey = text(fields[settings.fields.publicKey]);
    const generated = !publicKey;
    if (generated) publicKey = keyFactory();
    if (!PUBLIC_KEY_PATTERN.test(publicKey)) {
      throw new Error(`记录 ${record.id} 的公开ID格式无效`);
    }
    if (usedKeys.has(publicKey)) throw new Error(`公开ID重复：${publicKey}`);
    usedKeys.add(publicKey);

    const publicUrl = `${settings.siteUrl}/h/${publicKey}/`;
    if (generated || text(fields[settings.fields.publicUrl]) !== publicUrl) {
      patches.push({
        id: record.id,
        fields: {
          [settings.fields.publicKey]: publicKey,
          [settings.fields.publicUrl]: publicUrl
        }
      });
    }

    pages.push({ id: record.id, episode, name, prompt, attachments, delaySeconds, publicKey, publicUrl });
  }

  pages.sort((a, b) => a.episode.localeCompare(b.episode, "zh-CN") || a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
  if (pages.length === 0) throw new Error("NocoDB 内容表没有可发布记录");
  return { pages, patches };
}

async function copyPreservedRootFiles(sourceDir, stageDir) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    if (lower === "cname" || lower === ".nojekyll" || lower === "background.jpg" || lower.endsWith(".txt")) {
      await fs.copyFile(path.join(sourceDir, entry.name), path.join(stageDir, entry.name));
    }
  }
  await fs.writeFile(path.join(stageDir, ".nojekyll"), "", "utf8");
}

function applyTemplate(template, page, media) {
  const firstDisplay = `${String(Math.floor(page.delaySeconds / 60)).padStart(2, "0")}:${String(page.delaySeconds % 60).padStart(2, "0")}`;
  const replacements = {
    "{{PAGE_TITLE}}": escapeHtml(`${page.episode} · ${page.name}`),
    "{{COUNTDOWN_LABEL}}": firstDisplay,
    "{{COUNTDOWN_SECONDS}}": String(page.delaySeconds),
    "{{PROMPT_HTML}}": promptHtml(page.prompt),
    "{{MEDIA_HTML}}": media.length ? `<div class="media">${media.map(mediaMarkup).join("\n")}</div>` : ""
  };
  let output = template;
  for (const [token, value] of Object.entries(replacements)) output = output.replaceAll(token, value);
  return output;
}

export async function buildSite({ pages, docsDir, templatePath, client, maxFileBytes }) {
  const parent = path.dirname(docsDir);
  const stageDir = await fs.mkdtemp(path.join(parent, ".publish-stage-"));
  try {
    await copyPreservedRootFiles(docsDir, stageDir);
    const template = await fs.readFile(templatePath, "utf8");

    for (const page of pages) {
      const pageDir = path.join(stageDir, "h", page.publicKey);
      const mediaDir = path.join(pageDir, "media");
      await fs.mkdir(pageDir, { recursive: true });
      const media = [];

      for (let index = 0; index < page.attachments.length; index += 1) {
        const attachment = page.attachments[index];
        const downloaded = await client.downloadAttachment(attachment, maxFileBytes);
        const originalName = safeFilename(attachment.name, `附件-${index + 1}`);
        const filename = `${String(index + 1).padStart(2, "0")}-${originalName}`;
        await fs.mkdir(mediaDir, { recursive: true });
        await fs.writeFile(path.join(mediaDir, filename), downloaded.bytes);
        let mime = downloaded.mime || attachment.mime || guessMime(filename);
        if (mime === "application/octet-stream") mime = attachment.mime || guessMime(filename);
        media.push({
          filename,
          originalName,
          mime
        });
      }

      await fs.writeFile(path.join(pageDir, "index.html"), applyTemplate(template, page, media), "utf8");
    }
    return stageDir;
  } catch (error) {
    await fs.rm(stageDir, { recursive: true, force: true });
    throw error;
  }
}

export async function replaceDocsAtomically(stageDir, docsDir) {
  const parent = path.dirname(docsDir);
  const backupDir = await fs.mkdtemp(path.join(parent, ".publish-backup-"));
  await fs.rmdir(backupDir);
  const hadDocs = await fs.stat(docsDir).then(() => true, () => false);
  if (hadDocs) await fs.rename(docsDir, backupDir);
  try {
    await fs.rename(stageDir, docsDir);
    if (hadDocs) await fs.rm(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (hadDocs) await fs.rename(backupDir, docsDir).catch(() => {});
    throw error;
  }
}
