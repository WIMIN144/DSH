#!/usr/bin/env node
// sync-branches.mjs — 把 main 子目录里的插件发布到对应的可安装分支。
//
// 用法（在 main 分支、工作区干净时运行）:
//   node scripts/sync-branches.mjs zhipu        # 发布 dsh-zhipu-balance
//   node scripts/sync-branches.mjs whale        # 发布 dsh-whale-widget-w
//   node scripts/sync-branches.mjs all          # 两个都发布
//   node scripts/sync-branches.mjs zhipu --no-push   # 只更新本地分支，不推送
//
// 分支首次创建用 git subtree split（继承插件自己的提交历史）；之后的同步是
// 普通提交：checkout 分支 → 清空 → 从 main 的子目录复制 → commit → push。

import { execSync } from "node:child_process";
import { cpSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGINS = {
  zhipu: "dsh-zhipu-balance",
  whale: "dsh-whale-widget-w",
};

const args = process.argv.slice(2);
const noPush = args.includes("--no-push");
const targetArg = args.find((a) => !a.startsWith("--"));
const targets = targetArg === "all" ? Object.keys(PLUGINS) : [targetArg];

if (!targetArg || !targets.every((t) => t in PLUGINS)) {
  console.error("用法: node scripts/sync-branches.mjs <zhipu|whale|all> [--no-push]");
  process.exit(1);
}

const run = (cmd) => execSync(cmd).toString().trim();
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

if (run("git rev-parse --abbrev-ref HEAD") !== "main")
  die("请先切到 main 分支再运行本脚本");
if (run("git status --porcelain") !== "")
  die("main 工作区有未提交改动，请先提交再同步（否则分支会漏掉这些改动）");

const root = run("git rev-parse --show-toplevel");

for (const t of targets) {
  const dir = PLUGINS[t];
  console.log(`\n=== ${dir} → 分支 ${t} ===`);

  // 分支是否已存在
  let exists = true;
  try { run(`git rev-parse --verify --quiet refs/heads/${t}`); }
  catch { exists = false; }

  if (!exists) {
    run(`git subtree split -P ${dir} -b ${t}`);
    console.log(`已创建分支 ${t}（subtree split，继承插件完整提交历史）`);
  } else {
    // 先把 main 子目录快照到系统临时目录——checkout 分支后该子目录会从工作区消失，
    // 原实现直接读 join(root, dir) 会 ENOENT，并把工作区留在「已切分支 + 全删暂存」的中间态
    const staging = join(tmpdir(), `dsh-sync-${t}-${Date.now()}`);
    cpSync(join(root, dir), staging, { recursive: true });
    run(`git checkout ${t}`);
    // 清空分支根目录的全部跟踪文件，再从快照复制最新内容
    run("git rm -rq .");
    for (const entry of readdirSync(staging))
      cpSync(join(staging, entry), join(root, entry), { recursive: true });
    rmSync(staging, { recursive: true, force: true });
    run("git add -A");
    if (run("git status --porcelain") !== "") {
      const ref = run("git rev-parse --short main");
      run(`git commit -m "sync: from main@${ref}"`);
      console.log(`分支 ${t} 已更新 (from main@${ref})`);
    } else {
      console.log(`分支 ${t} 与 main 一致，无内容变化`);
    }
    run("git checkout main");
  }

  if (noPush) console.log(`--no-push: 分支 ${t} 保留在本地，未推送`);
  else run(`git push -u origin ${t}`);
}

console.log("\n完成。");
