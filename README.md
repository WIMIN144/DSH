# dsh 插件集合

本仓库收集我（WIMIN144）的 DSH（DeepSeek Harness）插件，每个插件独立一个子目录，互不依赖。

| 子目录 | 插件 | 说明 |
|---|---|---|
| [dsh-whale-widget-w](./dsh-whale-widget-w) | `dsh-whale-widget-w` | **小鲸鱼余额挂件 W 魔改版 W3（当前 `0.3.5-w.3`）**，基于 [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) `0.3.5` 并同步上游 0.3.6~0.3.9 修复：W 功能面板（常驻分组 / 轮播 / 峰谷 / 校准 / 生态与联锁）、泡泡管理分组系统（逐颗开关与权重、打标、重命名、图库上传自动压缩）、今日/本月用量明细泡（前端 + 官方校准双模式，需配油猴脚本）、节假日峰谷与峰时锁定。详见 [README-W.md](./dsh-whale-widget-w/README-W.md) |
| [dsh-zhipu-balance](./dsh-zhipu-balance) | `dsh-zhipu-balance` | 智谱/BigModel 余额与用量面板：API 配额/资源包 + GLM Coding Plan 窗口，右缘可折叠面板。**⚠ 已停止维护** —— 功能计划并入 `dsh-whale-widget-w` 的 W4（智谱生态），届时本目录会删除；现有安装仍可用，但不再更新 |

## 安装

`main` 分支是开发用的插件集合，**不能直接安装**（根目录没有 package.json）。每个插件发布在同名分支上，分支根目录就是插件本体，可用插件管理器直接安装：

```powershell
dsh plugin --profile web add github:WIMIN144/DSH#zhipu
dsh plugin --profile web add github:WIMIN144/DSH#whale
```

或在 dsh 插件页的 git 安装框里填 `github:WIMIN144/DSH#zhipu` / `github:WIMIN144/DSH#whale`。

各插件的完整说明见各自子目录内的 README。

## 维护者指南：发布插件更新

日常开发在 `main` 的子目录里进行。发布时运行同步脚本，把子目录内容发布到对应安装分支：

```powershell
node scripts/sync-branches.mjs zhipu     # 发布 dsh-zhipu-balance → zhipu 分支
node scripts/sync-branches.mjs whale    # 发布 dsh-whale-widget-w → whale 分支
node scripts/sync-branches.mjs all      # 两个都发布
```

脚本会用 `git subtree split` 把子目录（含完整提交历史）重建为分支根目录，并 push 到 origin。
