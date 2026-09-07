import { spawnSync } from "node:child_process";
import { DEFAULT_MAX_FILE_BYTES } from "./lib/settings.mjs";
import { formatBytes } from "./lib/nocodb.mjs";

const maxBytes = Number(process.env.MAX_FILE_BYTES || DEFAULT_MAX_FILE_BYTES);
const stagedOnly = process.argv.includes("--staged");
if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
  throw new Error("MAX_FILE_BYTES 必须是正整数");
}

function git(args, encoding = "utf8") {
  const result = spawnSync("git", args, { encoding });
  if (result.status !== 0) throw new Error(result.stderr?.toString() || `git ${args.join(" ")} 失败`);
  return result.stdout;
}

const raw = stagedOnly
  ? git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], null)
  : git(["ls-files", "-z"], null);
const files = raw.toString("utf8").split("\0").filter(Boolean);
const oversized = [];

for (const file of files) {
  const object = stagedOnly ? `:${file}` : `HEAD:${file}`;
  const result = spawnSync("git", ["cat-file", "-s", object], { encoding: "utf8" });
  if (result.status !== 0) continue;
  const size = Number(result.stdout.trim());
  if (size > maxBytes) oversized.push({ file, size });
}

if (oversized.length) {
  console.error(`以下文件超过 Git 单文件上限 ${formatBytes(maxBytes)}：`);
  for (const item of oversized) console.error(`- ${item.file}: ${formatBytes(item.size)}`);
  process.exitCode = 1;
} else {
  console.log(`文件大小检查通过：${files.length} 个文件，单文件上限 ${formatBytes(maxBytes)}`);
}
