import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = path.join(repoRoot, "docs");
const placeholders = /\{\{(?:PAGE_TITLE|COUNTDOWN_LABEL|COUNTDOWN_SECONDS|PROMPT_HTML|MEDIA_HTML)\}\}/;

async function walk(directory) {
  const output = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(fullPath));
    else output.push(fullPath);
  }
  return output;
}

const files = await walk(docsDir);
const pages = files.filter(file => file.endsWith(".html"));
if (!pages.length) throw new Error("docs 中没有 HTML 页面");
for (const page of pages) {
  const html = await fs.readFile(page, "utf8");
  if (placeholders.test(html)) throw new Error(`${path.relative(repoRoot, page)} 含有未渲染占位符`);
}
console.log(`静态站点检查通过：${pages.length} 个 HTML 页面，${files.length} 个文件`);
