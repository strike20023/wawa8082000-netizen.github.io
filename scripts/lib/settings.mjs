import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_MAX_FILE_BYTES = 95 * 1024 * 1024;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");

function integer(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return parsed;
}

export function loadSettings(env = process.env) {
  const siteUrl = (env.PUBLISH_SITE_URL || "https://strike20023.github.io/wawa8082000-netizen.github.io")
    .replace(/\/+$/, "");
  const repoRoot = path.resolve(env.PUBLISH_REPO_ROOT || REPO_ROOT);

  return {
    repoRoot,
    docsDir: path.resolve(env.PUBLISH_DOCS_DIR || path.join(repoRoot, "docs")),
    templatePath: path.resolve(env.PUBLISH_TEMPLATE_PATH || path.join(repoRoot, "template.html")),
    nocodbUrl: (env.NOCODB_URL || "http://127.0.0.1:8080").replace(/\/+$/, ""),
    apiToken: env.NOCODB_API_TOKEN || "",
    baseId: env.NOCODB_BASE_ID || "",
    tableId: env.NOCODB_TABLE_ID || "",
    siteUrl,
    maxFileBytes: integer(env.MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES, "MAX_FILE_BYTES"),
    defaultDelaySeconds: integer(env.DEFAULT_DELAY_SECONDS, 180, "DEFAULT_DELAY_SECONDS"),
    gitRemote: env.PUBLISH_GIT_REMOTE || "origin",
    gitBranch: env.PUBLISH_GIT_BRANCH || "main",
    skipGit: env.PUBLISH_SKIP_GIT === "1",
    fields: {
      episode: env.NOCODB_FIELD_EPISODE || "剧集",
      name: env.NOCODB_FIELD_NAME || "提示名称",
      prompt: env.NOCODB_FIELD_PROMPT || "提示词",
      media: env.NOCODB_FIELD_MEDIA || "多媒体",
      delay: env.NOCODB_FIELD_DELAY || "罚时（秒）",
      publicKey: env.NOCODB_FIELD_PUBLIC_KEY || "公开ID",
      publicUrl: env.NOCODB_FIELD_PUBLIC_URL || "网址"
    }
  };
}

export function requireNocoDbSettings(settings) {
  const missing = [];
  if (!settings.apiToken) missing.push("NOCODB_API_TOKEN");
  if (!settings.baseId) missing.push("NOCODB_BASE_ID");
  if (!settings.tableId) missing.push("NOCODB_TABLE_ID");
  if (missing.length) {
    throw new Error(`缺少 NocoDB 配置：${missing.join(", ")}`);
  }
}
