import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadSettings, requireNocoDbSettings } from "./lib/settings.mjs";
import { NocoDbClient } from "./lib/nocodb.mjs";
import { buildSite, preparePages, replaceDocsAtomically } from "./lib/site.mjs";

function run(command, args, { cwd, allowExitCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      if (!allowExitCodes.includes(code)) {
        reject(new Error(`${command} ${args.join(" ")} 失败 (${code})\n${stderr || stdout}`));
      } else {
        resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
  });
}

async function publishGit(settings) {
  const cwd = settings.repoRoot;
  const stagedBefore = await run("git", ["diff", "--cached", "--name-only"], { cwd });
  if (stagedBefore.stdout) throw new Error("发布前暂存区不为空，请先处理已有暂存内容");

  await run("git", ["fetch", settings.gitRemote, settings.gitBranch], { cwd });
  const counts = await run("git", ["rev-list", "--left-right", "--count", `${settings.gitRemote}/${settings.gitBranch}...HEAD`], { cwd });
  const [remoteOnly, localOnly] = counts.stdout.split(/\s+/).map(Number);
  if (remoteOnly > 0) throw new Error(`远端 ${settings.gitBranch} 比当前 Codespace 新，请先同步后再发布`);

  await run("git", ["add", "--", "docs"], { cwd });
  await run(process.execPath, ["scripts/check-file-sizes.mjs", "--staged"], { cwd });
  const diff = await run("git", ["diff", "--cached", "--quiet"], { cwd, allowExitCodes: [0, 1] });
  if (diff.code === 1) {
    await run("git", ["commit", "-m", "Publish NocoDB content"], { cwd });
  } else if (localOnly === 0) {
    return { committed: false, pushed: false, message: "内容没有变化" };
  }
  await run("git", ["push", settings.gitRemote, `HEAD:${settings.gitBranch}`], { cwd });
  const sha = await run("git", ["rev-parse", "--short", "HEAD"], { cwd });
  return { committed: diff.code === 1, pushed: true, sha: sha.stdout };
}

export async function runPublish({ env = process.env, onProgress = () => {} } = {}) {
  const settings = loadSettings(env);
  requireNocoDbSettings(settings);
  const client = new NocoDbClient({
    baseUrl: settings.nocodbUrl,
    apiToken: settings.apiToken,
    baseId: settings.baseId,
    tableId: settings.tableId
  });

  let stageDir;
  try {
    onProgress("读取 NocoDB 内容");
    const records = await client.listRecords();
    const { pages, patches } = preparePages(records, settings);

    onProgress(`生成 ${pages.length} 个静态页面`);
    stageDir = await buildSite({
      pages,
      docsDir: settings.docsDir,
      templatePath: settings.templatePath,
      client,
      maxFileBytes: settings.maxFileBytes
    });

    if (patches.length) {
      onProgress("回写自动网址");
      await client.patchRecords(patches);
    }

    onProgress("替换静态站点");
    await replaceDocsAtomically(stageDir, settings.docsDir);
    stageDir = undefined;

    let git = { committed: false, pushed: false, message: "已跳过 Git" };
    if (!settings.skipGit) {
      onProgress("提交并推送 Git");
      git = await publishGit(settings);
    }
    return { pages: pages.length, patched: patches.length, git };
  } finally {
    if (stageDir) {
      const fs = await import("node:fs/promises");
      await fs.rm(stageDir, { recursive: true, force: true });
    }
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  runPublish({ onProgress: message => console.log(`[publish] ${message}`) })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error(`[publish] ${error.message}`);
      process.exitCode = 1;
    });
}
