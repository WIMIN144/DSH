# dsh 插件集合

本仓库收集我（WIMIN144）的 DSH（DeepSeek Harness）插件，每个插件独立一个子目录，互不依赖。

| 子目录 | 插件 | 说明 |
|---|---|---|
| [dsh-zhipu-balance](./dsh-zhipu-balance) | `dsh-zhipu-balance` | 智谱/BigModel 余额与用量面板：API 配额/资源包 + GLM Coding Plan 窗口，右缘可折叠面板 |
| [dsh-whale-widget-w](./dsh-whale-widget-w) | `dsh-whale-widget-w` | 小鲸鱼余额挂件 W 魔改版（基于 [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) 0.2.10）：常驻显示下拉框、梁文峰时段锁定（峰时隐藏发送按钮+拦键盘）、锁定气泡倒计时轮播、菜单悬停说明等 |

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
