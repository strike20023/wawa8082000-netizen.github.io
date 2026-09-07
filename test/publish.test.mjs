import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { NocoDbClient, normalizeAttachments } from "../scripts/lib/nocodb.mjs";
import { buildSite, preparePages, replaceDocsAtomically } from "../scripts/lib/site.mjs";
import { loadSettings } from "../scripts/lib/settings.mjs";

function settings(root) {
  return loadSettings({
    PUBLISH_REPO_ROOT: root,
    PUBLISH_DOCS_DIR: path.join(root, "docs"),
    PUBLISH_TEMPLATE_PATH: path.join(root, "template.html"),
    PUBLISH_SITE_URL: "https://example.test/game",
    MAX_FILE_BYTES: "1024"
  });
}

test("preparePages keeps the editor-facing schema small and generates URLs", () => {
  const config = settings("/tmp/example");
  const records = [{
    id: 7,
    fields: {
      剧集: "隐秘的见证",
      提示名称: "1-1",
      提示词: "第一行\n<script>alert(1)</script>",
      多媒体: [{ title: "线索.jpg", url: "/download/1", mimetype: "image/jpeg", size: 12 }],
      "罚时（秒）": 180,
      公开ID: "",
      网址: ""
    }
  }];

  const { pages, patches } = preparePages(records, config, () => "fixedKey123");
  assert.equal(pages.length, 1);
  assert.equal(pages[0].publicUrl, "https://example.test/game/h/fixedKey123/");
  assert.deepEqual(patches, [{
    id: 7,
    fields: {
      公开ID: "fixedKey123",
      网址: "https://example.test/game/h/fixedKey123/"
    }
  }]);
});

test("buildSite renders escaped text and image, audio, and video media", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wawa-publish-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const docsDir = path.join(root, "docs");
  await fs.mkdir(docsDir);
  await fs.writeFile(path.join(docsDir, "background.jpg"), "background");
  await fs.writeFile(path.join(docsDir, "verify.txt"), "verify");
  await fs.writeFile(path.join(docsDir, "old.html"), "old");
  const templatePath = path.join(root, "template.html");
  await fs.copyFile(path.resolve("template.html"), templatePath);

  const page = {
    id: 1,
    episode: "第一集",
    name: "1-1",
    prompt: "文字 <b>不能注入</b>",
    delaySeconds: 2,
    publicKey: "fixedKey123",
    publicUrl: "https://example.test/h/fixedKey123/",
    attachments: [
      { name: "图.jpg", url: "/image", mime: "image/jpeg", size: 3 },
      { name: "声.mp3", url: "/audio", mime: "audio/mpeg", size: 3 },
      { name: "影.mp4", url: "/video", mime: "video/mp4", size: 3 }
    ]
  };
  const client = {
    async downloadAttachment(attachment) {
      return { bytes: new TextEncoder().encode("abc"), mime: attachment.mime };
    }
  };

  const stage = await buildSite({ pages: [page], docsDir, templatePath, client, maxFileBytes: 1024 });
  await replaceDocsAtomically(stage, docsDir);
  const html = await fs.readFile(path.join(docsDir, "h", "fixedKey123", "index.html"), "utf8");

  assert.match(html, /文字 &lt;b&gt;不能注入&lt;\/b&gt;/);
  assert.match(html, /<img /);
  assert.match(html, /<audio /);
  assert.match(html, /<video /);
  assert.match(html, /let time = 2/);
  assert.equal(await fs.readFile(path.join(docsDir, "verify.txt"), "utf8"), "verify");
  await assert.rejects(fs.access(path.join(docsDir, "old.html")));
});

test("preparePages rejects oversized attachments before download", () => {
  const config = settings("/tmp/example");
  const records = [{
    id: 8,
    fields: {
      剧集: "第一集",
      提示名称: "1-2",
      提示词: "提示",
      多媒体: [{ title: "large.mp4", url: "/large", size: 2048 }],
      公开ID: "fixedKey456"
    }
  }];
  const { pages } = preparePages(records, config);
  const client = new NocoDbClient({
    baseUrl: "http://localhost:8080",
    apiToken: "token",
    baseId: "base",
    tableId: "table",
    fetchImpl: () => { throw new Error("不应下载"); }
  });
  assert.rejects(() => client.downloadAttachment(pages[0].attachments[0], config.maxFileBytes), /超过/);
});

test("normalizeAttachments accepts NocoDB JSON attachment values", () => {
  const attachments = normalizeAttachments('[{"title":"a.mp3","url":"/a","mimetype":"audio/mpeg","size":5}]');
  assert.deepEqual(attachments, [{ name: "a.mp3", url: "/a", mime: "audio/mpeg", size: 5 }]);
});

test("NocoDbClient follows v3 pagination and batches patches", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const body = options.method === "PATCH"
      ? { records: [] }
      : url.includes("page=2")
        ? { records: [{ id: 2, fields: {} }], next: null }
        : { records: [{ id: 1, fields: {} }], next: "/api/v3/data/b/t/records?page=2" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new NocoDbClient({ baseUrl: "http://noco.test", apiToken: "secret", baseId: "b", tableId: "t", fetchImpl });
  assert.deepEqual((await client.listRecords()).map(record => record.id), [1, 2]);
  await client.patchRecords(Array.from({ length: 11 }, (_, index) => ({ id: index, fields: {} })));
  assert.equal(calls.filter(call => call.options.method === "PATCH").length, 2);
  assert.equal(calls[0].options.headers["xc-token"], "secret");
});

test("NocoDbClient does not send its API token to external attachment storage", async () => {
  let receivedHeaders;
  const client = new NocoDbClient({
    baseUrl: "http://noco.test",
    apiToken: "secret",
    baseId: "b",
    tableId: "t",
    fetchImpl: async (_url, options) => {
      receivedHeaders = options.headers;
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "3" }
      });
    }
  });
  await client.downloadAttachment({ name: "x.png", url: "https://storage.test/x.png", size: 3 }, 10);
  assert.equal(receivedHeaders["xc-token"], undefined);
});

test("Git size guard rejects oversized staged blobs", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wawa-git-size-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git("init", "-q");
  await fs.writeFile(path.join(root, "small.bin"), Buffer.alloc(4));
  git("add", "small.bin");

  const checker = path.resolve("scripts/check-file-sizes.mjs");
  const small = spawnSync(process.execPath, [checker, "--staged"], {
    cwd: root,
    env: { ...process.env, MAX_FILE_BYTES: "5" },
    encoding: "utf8"
  });
  assert.equal(small.status, 0, small.stderr);

  await fs.writeFile(path.join(root, "large.bin"), Buffer.alloc(6));
  git("add", "large.bin");
  const large = spawnSync(process.execPath, [checker, "--staged"], {
    cwd: root,
    env: { ...process.env, MAX_FILE_BYTES: "5" },
    encoding: "utf8"
  });
  assert.equal(large.status, 1);
  assert.match(large.stderr, /large\.bin/);
});
