# dsh 插件集合

本仓库收集我（WIMIN144）的 DSH（DeepSeek Harness）插件，每个插件独立一个子目录，互不依赖。

| 子目录 | 插件 | 说明 |
|---|---|---|
| [dsh-zhipu-balance](./dsh-zhipu-balance) | `dsh-zhipu-balance` | 智谱/BigModel 余额与用量面板：API 配额/资源包 + GLM Coding Plan 窗口，右缘可折叠面板 |
| [dsh-whale-widget-w](./dsh-whale-widget-w) | `dsh-whale-widget-w` | 小鲸鱼余额挂件 W 魔改版（基于 [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) 0.2.10）：常驻显示下拉框、梁文峰时段锁定（峰时隐藏发送按钮+拦键盘）、锁定气泡倒计时轮播、菜单悬停说明等 |

## 安装

仓库根目录是插件集合，不是单个插件包，安装时指向对应子目录（本地 link 方式）：

```powershell
git clone https://github.com/WIMIN144/dsh.git
dsh plugin --profile web add link:<克隆路径>\dsh-zhipu-balance
dsh plugin --profile web add link:<克隆路径>\dsh-whale-widget-w
```

各插件的完整说明见各自子目录内的 README。
