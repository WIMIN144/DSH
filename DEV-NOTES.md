# DEV-NOTES · 开发者备忘录（dsh-whale-widget-w）

> 面向插件维护者本人，不随对外文档宣传。记录测试代码状态、调试钩子、已知坑与维护操作。
> 配套用户文档：[README-W.md](README-W.md)。

## 1. 版本与仓库状态

- 当前版本 `0.3.5-w.3`（沿用内部 W.3 叫法；基线为原版 `0.3.5`，含 `lib/accounting.mjs` 记账内核），已整体重写 W.3 功能。
- **宿主实测版本 `dsh 0.1.5-rc.3`**（2026-09-23 从 0.1.5-rc.1 升级后挂载/路由/信任栅栏全绿）。挂件对宿主只有四处依赖：`webServer.register` + `webServer.tapIndex`、前端 `data-composer-input`（或 `seat`/`card`）、`connection.requestRejection`、宿主读 `settings.yaml` 的 `agent-default-model.model` —— 升级 dsh 后只需核这四处，前端不碰 dsh 自己的 `/api/*`。
- ⚠ 升 dsh **不要 `npm i -g @deepseek-ai/dsh@latest`**：`latest` 标签停在 rc.2，它的 `^0.1.5-rc.2` 依赖会把 cordis 漂到 4.0.4，结果是 `dsh web` 起不来（`plugin(s) failed to load: @deepseek-ai/dsh-sandbox-local`，npm 把它嵌到了 `dsh-base/node_modules` 下，cordis 从根目录解析不到）。装 **`@next`**（rc.3，把 cordis 精确钉在 4.0.2）正常。另外 `npm install -g` 会打死正在跑的 `dsh web`（lazy require 去磁盘取模块就崩），装完要自己重启。
- **已发布**（2026-09-23）：仓库 `WIMIN144/DSH`，`main` 的 `dsh-whale-widget-w/` 子目录 = 开发源，**`whale` 分支根目录 = 安装源**（`github:WIMIN144/DSH#whale`），tag `v0.3.5-w.3` + GitHub Release。本机这份 `plugins\dsh-whale-widget-w` 仍是**无 `.git` 的工作副本**（开发时用 `link:` 挂 dsh）。发布流程：把这份拷进 clone 的 `main` 子目录 → commit → push → `node scripts/sync-branches.mjs whale`（脚本细节与它的坑见 §15）。
- ⚠ 仓库里 `main` 根目录**没有 package.json**，所以 `git+https://…#main` 或仓库根地址装不了；也别指望 `…/tree/main/dsh-whale-widget-w` 这种子目录地址 —— 安装一律走**分支根**。
- ⚠ 本文档与 `HANDOFF.md` 里不要再写死含用户名的绝对路径（`C:\Users\...`、`D:\...`）——这两个文件会随包发布。
- `.github/workflows/publish.yml`（W.2 时代的发布流水线）与 `docs/` 旧截图已随基线重置删除；`docs/` 已按 README-W 重新补齐 13 张（清单与打码流程见 §8）。

## 2. 调试钩子（dsh 页面控制台）

```js
window.__dshwTrigDebug.forcePeak(true/false)  // 强制峰时（验证锁定泡+隐藏发送按钮+拦截回车）
window.__dshwTrigDebug.fakeRemain(1200)       // 注入"谷时剩20分钟"（验证谷时将尽泡）
window.__dshwTrigDebug.pool()                 // 查看常驻池（含启用/触发条件双检后的结果）
window.__dshwTrigDebug.evaluate()             // 手动跑一次触发评估
window.__dshwTrigDebug.tick()                 // 手动跑一次常驻 tick
window.__dshwTrigDebug.off(id, true/false)    // 逐颗泡独立开关（不传 id 返回整张关闭表）
window.__dshwTrigDebug.models(['glm-4.6'])    // 注入「最近一轮用的模型」验证用量泡的 DeepSeek 门控；传 null 清空
window.__dshwTrigDebug.seq()                  // 点击序列的条目 id（并列步形如 q1[a|b]）
window.__dshwTrigDebug.carMode('order')       // 读/写轮播方式（'random' | 'order'），写的时候会同步下拉并上推
window.__dshwTrigDebug.order()                // 按当前池子算一整轮顺序（组权重→气泡权重），验证覆盖与排序用
window.__dshwTrigDebug.ew(id)                 // 读某颗泡的生效权重；不传 id 返回整张覆盖表
```

## 3. 测试代码状态

- **无测试代码残留**（`grep dshwFakeTl|fakeTimeline` 为 0）。
- **峰谷假时间线**：曾完整迁移（W.2 的 FAKE_TRANSITION_TEST 方案改成控制台开关），实测未生效后已整体移除。
  - 已验证的实现思路：劫持 `bubbleIsPeakNow()` / `bubbleCountdownIsPeak()` / `bubbleCountdownNextChange()` 三个时间源函数即可让全链路（状态字/倒计时/触发泡/锁定）跟着走；`__dshwTrigDebug.fakeTimeline(true, 谷秒, 峰秒)` 开关 + 自动还原的写法已跑通语法。
  - 上次未生效的头号嫌疑：**页面跑了旧脚本**（当时未确认硬刷新）。⚠ `fakeTimeline` 这个钩子**已随方案一起删掉了**（现在 `__dshwTrigDebug` 里没有它），下次重做要重新实现，别按旧名字去找；只要时间片段的话，现有替身够用：`__dshwTrigDebug.forcePeak()` 与 `fakeRemain(秒)`（见 §2）。

## 4. 已知坑（踩过两次以上/容易再犯）

1. **菜单/泡泡开合判定必须用 class**（`dshwv-menu-open` / `dshwv-pop-open`），rect 高度在隐藏态不为 0。
2. **条目 id 按位置生成**（q0/q1a…）：任何改动点击序列的操作都必须重映射四张表（组 items / `dshwWEntryOff` / `dshwWEntryW` / `dshwWTrigAssign`）。0.3.5-w.3 起统一在 `saveBubbleCfg` 落盘成功后由 `wGroupsResyncAfterSave(旧序列, 新序列)` 做**内容签名配对**：删一步、加一步、拖动换序、只改模块内容，都能让归属跟着那颗泡走（旧「拖动顺序后归属不跟随」的简化已解决）。两个例外要显式传 `skipGroupResync=true`：组管理删泡（自己已经 `wGroupsAfterStepDelete` 过，再映射会二次位移）、恢复默认（组结构刚按出厂重建）。
3. 官方用量接口 `body.code === 0` = 请求成功但该时段无出账数据（不是错误）；令牌类业务错误码是 40003。
4. 宿主 isPeak 就绪后前端判定以宿主为准（`bubbleIsPeakNow` 优先 `state.isPeak`）——任何峰谷测试方案都必须劫持这一层，只改 `bubbleCountdownIsPeak` 不够。
5. 平台令牌推送路由（`/dsh-whale/platform-token`）**有意不走信任栅栏**（外站油猴脚本没有本地凭据），改用自己的 Origin 校验：`platformTokenOrigin()` 用 `new URL(...).origin` 与 `https://platform.deepseek.com` **精确比对**（早先的前缀 `indexOf(...) !== 0` 会被 `platform.deepseek.com.evil.tld` 绕过），Origin 优先、没有才退回 Referer，两个头都没带才放行（GM_xmlhttpRequest 在部分浏览器不带页面 Origin；这条兼容路径不回任何 CORS 头，并往 dsh 控制台打一条日志）。OPTIONS 预检同样要先过这道校验，且只回显命中的那个 Origin。改这条路由时不要退回「通配 + 缺头放行」。
6. 「今日」时段官方拉取曾持续返回 code 0 空数据（2026-09-20 观察），本月正常；已在宿主加失败退避（2 分钟）+ 日志节流（10 分钟），后续观察是否长期如此。
7. **组结构有两条读取路径，必须共用同一口径**：组管理读内存 `wGroups`（`wGroupsLoad` 在 localStorage 为空时回退出厂组），常驻/轮播读 `wRuntimeGroups()`。出厂组**从不落盘**，所以任何一侧「只认存储」都会在新浏览器/新机器上表现为「组管理看得见组、常驻下拉显示暂无分组」。现两者共用 `wGroupsReadStored()`，缺失即回退 `wGroupDefaultGroups()`。
8. **出厂组的条目 id 必须按默认目录推导**（`wGroupCatalog(bubbleDefaultQueue())`），不能写死 `q1`/`q2`：默认队列第 2 步是并列 A/B 泡、目录 id 是 `q1a`/`q1b`，写死的 id 会被 `wGroupRender` 当失效条目剔除，A 组永远常驻不了。同理早先那条「q1a→q1、q1b→q2 摊平映射」在当前目录方案下会把有效 id 改坏，已删。
9. **W 设置同步层的四条约定**（`.dshw-w.json`，见第 5 节）：① 新增 W 设置键要同时加进前端 `W_SETTINGS_KEYS` 与宿主 `W_SETTINGS_VALID` 白名单，漏一边就不持久化；② 冲突口径是**服务端为准**，唯一例外是回填完成前**用户**已改过（`wSettingsDirty`）→ 本机为准直接上推；③ 多标签页同开是「最后写入者赢」，没有合并，别把它当同步协议用；④ **启动期自愈写一律不算「用户改过」**——`wGroupsLoad` 补条目、`wGroupsSyncIdsToCatalog` 回迁、`wGroupRender` 剔除都会写 localStorage 并上推，升级首启它们几乎必然早于镜像返回，若置了 dirty 就拿本机那份盖掉服务端镜像，跨浏览器恢复当场失效。这三处必须包在 `wSettingsHeal(fn)` 里（只挡 dirty，照常落盘上推）。
10. **条目编号的一切修补都必须等泡泡配置到达之后**：`wGroupCatalog()` 的 q 编号取决于点击序列形状 —— 出厂默认第 2 步是并列 A/B 泡（`q1a`/`q1b`），而用户自己编辑过的配置往往是摊平的三步（`q1`/`q2`）。在 `loadBubbleCfg()` 拿到配置之前跑回迁/补齐，会拿出厂目录去改用户的真实编号，把本来合法的 `q1`/`q2` 写成不存在的 `q1a`/`q1b`（表现为 A 组突然 0 条，2026-09-21 踩过）。现统一收在 `wGroupsSyncIdsToCatalog()`，由 `loadBubbleCfg` 的 then/catch 与 `wGroupRender` 调用。**`wGroupRender` 里的剔除/回迁整段由 `bubbleCfgArrived` 闸门管着**（`loadBubbleCfg` 成功或确认无配置才置位）：镜像回填走 `wSettingsApply → wGroupRender`，早于配置到达时目录还是出厂那份，闸门一破就会把用户多出来的点击泡当失效条目抹掉——同一条坑从镜像这条路复活过一次。
11. **自定义小面板别复用 `dshwDropOpen`**：它按「与触发控件等宽」定位（`width = 锚点宽`），挂在十几像素的 ✎ 上会被压成一条；而 `.dshwv-rgbmenu` 的 `min-width:100%` 在 body 下按视口算，会把面板撑满整屏。用小面板走 `wMiniPanelPlace()`，内联必须带 `min-width:0`。
12. **删点击序列的一步必须连带重编号所有按位置生成的引用**：条目 id 是 `q{位置}`，删掉第 N 步之后 N+1 会变成 N。`wGroupsAfterStepDelete(N)` 统一处理组 items、`dshwWEntryOff`、`dshwWEntryW`、`dshwWTrigAssign`、`dshwWEntryTag`、`dshwWEntryName` 六处；以后再加任何以 q/f 编号为键的存储，必须一起加进这个函数，否则那张表会集体错位指向别的泡。
13. **删除按钮的待删列表必须和目录同源同形**：只能取 `wGroupQueueSteps()`（深拷贝），别在「还没有泡泡配置」时拿 `bubbleFlattenSteps(bubbleDefaultQueue())` 兜底——摊平后的数组和 `q{idx}` 编号不同形，删 `q1b` 会命中 A 侧那颗，还立刻把错位配置落盘。并列 A/B 泡在配置 `items[]` 里就是一个 `kind:'choice'` 步骤，摊平是**编辑器**内部的事。
14. **泡泡编辑器开着时禁止从组管理删泡**：改动落在草稿工作副本上，而四张引用表按草稿编号被重写了，用户点「取消」放弃草稿 → 四张表整体错位指向别的泡。现在的处理是直接提示并返回；将来若要支持，得把重编号推迟到草稿保存成功那一刻。
15. **上游自带的死代码保持原样**：`mkRow / bubbleDefaultRandomLines / bubbleMoveMore / bubblePvFont / rgbToCss / swapBubbleContent / bubbleTodayText / bubbleModuleText / setUsageMode / audioSlotValue`（前端 10 个）与 `dayKeyOfDate / ledgerTodayTotal`（宿主 2 个）、`var STEP` / `var peakDrop`，在原版 `0.3.9` 里同样零引用；`bubbleDefaultQueue()` 里 `return` 之后那段不可达旧默认体也是上游原样。留着是为了逐版 `diff -u` 干净——**只删我们自己造成的死码**，删上游的要在 §10 记一笔。
16. **挂件 JSON 响应不带 `Access-Control-Allow-Origin`**：挂件脚本与 dsh 页面同源，通配头等于把余额、账本、模型表、设置镜像降级成「任意网页可读」。唯一的跨源消费者是平台令牌端点，它按校验通过的 Origin 单独回显（见 §4.5）。新加路由一律用 `JSON_HEADERS`，别把通配头加回去。
17. **提示条 `dshwvToast` 只按纯文本渲染**：消息里会拼宿主返回的错误串（`configSaveFailNotice` / 泡泡保存失败两处），走 `innerHTML` 就是 XSS 面；`<br>` 在渲染时换算成换行，新调用方直接写 `\n`。
18. **`visibleTopZ()` 里那个 `usageMask` 是个不存在的变量**（上游 0.3.9 同样只有 `usageMoreMask`/`resMaskEl`）：裸引用它会让候选表那一行抛 ReferenceError，而 `dshwDropOpen`/`dshwLayerUp` 整段都在 `try{}catch(err){}` 里 —— 异常被静默吞掉，**层级那一行永远执行不到**，所有下拉停在 CSS 的 `z-index:60`，被主菜单（10000）和 DSH 页面盖住，用户看到的就是「点常驻/方式没反应」。2026-09-22 移植 v748 之后就是这个现象。现在两处落层（`dshwDropOpen` / `wMiniPanelPlace`）各自把 `visibleTopZ()` 包进独立 try 并给 26010 兜底，**别再把它挪回大 try 的最后一行**。排查这类「点了没反应」先读弹层的 `getComputedStyle(...).zIndex`：60 = 这一类。
19. **常驻轮播：动图完整放完 > 轮播秒数**（用户定的优先级）。浏览器不给 GIF 动画进度，一圈多长只能自己从字节里读：`dshwGifLoopMs`（GCE 0x21F9 延迟累加，<20ms 按 20ms 抬，与浏览器一致）+ `dshwApngLoopMs`（fcTL 的 delay_num/den 累加），结果按 URL 缓存在 `wImgLoopCache`。`wPersistTick` 在按住期间把 `wPersistLastRot` 顶到 `一圈结束 - 轮播秒数`，于是**放完那一瞬立刻切走**，不多等一个周期；锚点 `wPersistGifAt` 必须在**轮播那一刻**置（不能等观察到 img 再置，会差一个 tick）。静态图/解析失败 = 0 → 老老实实按轮播秒数走。验证方法：临时实例上手动 `d.tick()` 忙等采样（隐藏标签页的 setInterval 会被节流到 1 分钟，别指望自动 tick 计时）。

20. **常驻的 mods 深拷贝视图必须把抽取状态带过轮播**：`bubblePickLine(lines, avoidIdx)` 的「不连续重复」是靠往模块里写 `_lastPick` / `_lastPickImg` 实现的。视图改成每轮深拷贝后，配置本体不再被写 → 每轮都从同一个初值重抽，**两张图的随机图片有 ~98% 概率永远避开同一张、只出另一张**（用户反馈"抽不到那张静态图"）。现在 `wPersistModsViewOf` 从 **`wPersistPickState`（按条目 id 存）** 取上一次的抽取结果种进新拷贝，`wPersistRender` 渲染完再 `wPersistPickCommit` 写回去。⚠ 别图省事改成"抄上一份视图的状态"—— 池子是 f0→q1→q2→f0 交替的，隔两颗回到同一颗时上一份视图已经是别的泡，状态照样丢（我第一次就是这么修的，用户实测仍抽不到）。验证要在真实页面里跑：把 `Date.now` 换成虚拟时钟 + 循环调 `__dshwTrigDebug.tick()`，400 次快进就能看出两张图各出现过（静图 29 / 动图 42 次采样）。实测 40 轮：两张各 20 次、连续重复 1 次（`bubblePickLine` 是 6 次重试的**概率性**防重复，2 选 1 时理论值 ~1.6%，不是 bug）；配置本体保持干净（签名才稳定）。

## 5. 存储与数据文件

| 位置 | 键/文件 | 内容 |
|---|---|---|
| localStorage | `dshwWGroupsV5` | 组结构 {id,name,w,items[]} |
| localStorage | `dshwWPersistGroups` / `dshwWCarousel` | 常驻勾选组 / 轮播秒数 |
| localStorage | `dshwWTriggers` / `dshwWTrigMods` / `dshwWTrigAssign` | 峰谷触发开关 / 触发泡文案覆盖 / 条目安排记录 |
| localStorage | `dshwWEntryOff` | 逐颗泡独立开关，只记**关掉**的条目 `{id:1}`（默认全开）；管常驻轮播 + 点击序列（`bubbleShowSeqNext` 按 `bubbleStampSeqIds` 打上的 id 跳过） |
| ~~`dshwWEntryDsOnly`~~ | **已废弃**（0.3.5-w.3 内）：逐条「仅 DeepSeek 模型时显示」勾选与生态联锁重复，勾选框、读写函数、`W_SETTINGS_KEYS`/宿主白名单条目一并删除；旧镜像里残留的键会被同步层忽略。等价规则改成内置的 `wDsGateOk(id)` = 「打了 DeepSeek 标 + 当前模型不是 DeepSeek → 隐藏」，仍作用于常驻池、点击序列、峰谷三条触发泡、余额/预算/每轮消耗。判定源：宿主 `last-turn.json` 的 `activeModel`（= 模型选择器当前值，按 mtime 缓存）优先，读不到才退回 `models[]`，两者都没有则不隐藏。`runApiModelAlerts` 走各厂商自己的链路，**不受此门控** |
| localStorage | `dshwWEco` | 生态：`deepseek` / `zhipu` / `qwen`（裸字符串，与 `dshwWCarouselMode` 同款透传）。**角色 `dshw-role` 仍只在本机浏览器**，不进镜像 —— 皮肤是每台设备自己的选择 |
| localStorage | `dshwWEntryTag` | 气泡打标 `{id: ['deepseek','qwen',…]}` —— **多选数组**，空数组 = 「无」。**只存与推导值不同的显式标**（推导 = `wEntryTagsDefault`：`wEntryDefaultsToDsTag(id)` → `['deepseek']`，其余 → `[]`），所以删键 = 回推导。旧版单值标（`'deepseek'`/`'custom'`/`'shared'`）读的时候兼容：认生态标，其余当「无」。「无 / 自定义 / 公用」那套单选方案已废（用户改成多选，公用=无） |
| localStorage | `dshwWEntryName` | 条目重命名 `{id:名字}`（≤24 字）。只替换行名中间那段，序号与模块摘要仍按实际算（`wEntryLabel`/`wGroupCatalog` 的 `dft` 字段）；清空即回默认。和打标一样要进 `wGroupsRemapIds`（见 §4.12） |
| localStorage | `dshwWEcoLock` | 生态联锁 `'1'/'0'`。⚠ 同步层 `JSON.parse` 会把它变成**数字 1/0**，宿主校验按数字写、回填时再 `JSON.stringify` 回 `'1'` —— 别按字符串枚举校验，否则整键被拒 |
| localStorage | `dshwWPersistSet` | 旧占位遗留，已不读写（恢复默认会清掉） |
| localStorage | `dshwWCarouselMode` | 轮播方式：`'random'`（到点按权重抽，历史行为）/ `'order'`（顺序轮播，一轮全部放一遍）。**裸字符串不是 JSON**，同步层对非 JSON 值原样透传，宿主按枚举校验 |
| localStorage | `dshwWEntryW` | 组内气泡权重覆盖 `{id:n}`（1-99）；未覆盖的走内置权重 = 配置里并列泡 `options[].w` / 单步 `w`，都没有则 1。摊平过的队列单步没有 `w`，所以内置值会回到 1，需要时在组管理行里直接填 |
| `$DSH_HOME` | `.dshw-w.json` | **上面这些 W 键的服务端镜像**（`{v,updatedAt,settings:{...}}`，白名单校验）。前端仍以 localStorage 为同步存储，启动时 `wSettingsHydrate()` 回填、写入点 `wSettingsPush()` 防抖 600ms 上推；服务端为空时把本机数据上推一次。路由 `/dsh-whale/w-settings.json`（走信任栅栏）。宿主写入是**按键合并**（本次没带上来的键保留镜像里那份，形状不合法也保留上一份好的），不是整包替换。宿主 `W_SETTINGS_VALID.dshwWGroupsV5` 与前端 `wGroupsReadStored()` 的组结构校验**逐条对齐**（含 `g.id` 必须是字符串）：只严在一侧就会出现「本机照用、镜像整键拒收」，换浏览器时静默不恢复 |
| `$DSH_HOME` | `.dshw-tokens.json` | 用量账本（模型×今日/本月分桶） |
| `$DSH_HOME` | `.dshw-platform-token.json` | 油猴脚本推送的平台令牌 |
| `$DSH_HOME` | `.dshw-size.json` / `.dshw-bubble.json` / `.dshw-usage.json` | 原版设置（含 calibRatio）/ 泡泡配置 / 记账账本 |
| `$DSH_HOME` | `whale-bubble-imgs/` + `bubble-imgs.json` | 用户泡泡图库（内置 `petpet`/`money1` 不在这里，走 assets 回退）。**入库的静态图已经是压缩过的**（最长边 ≤800px），见 §13；单张上限 32MB |

## 6. 年度维护：更新节假日表

1. 等国务院公布下一年放假安排；
2. 改 `lib/index.js` 顶部 `HOLIDAY_VALLEY_DAYS`（只需列落在周一至周五的法定放假日 `YYYY-MM-DD`，表按年分键）；
   - 生效分界 `HOLIDAY_VALLEY_FROM_SEC`（北京时间 2026-09-19 起「法定节假日全天谷价」）**已经接进 `isHolidayValley()`**：早于它的历史分桶按旧规则（只有周末谷价）计价，和旁边 `WEEKEND_VALLEY_FROM_SEC` 同一套路。**补下一年日期时不要动这个分界**。
3. 同步 `assets/whale-widget.js` 的 `BUILTIN_HOLIDAY_DAYS` 内置兜底表（搜索同名常量，两处保持一致）；前端三处取值统一走 `dshwHolidayDays()`（余额接口那份 → size.json 那份 → 内置兜底）。
4. `node --check` 两个文件 → 重启 dsh。表过期时页面会自动弹红色提示条提醒（含最后一天日期）。

## 7. 「恢复全局默认设置」的复位范围

- **本版基线 = 用户当前状态**（0.3.5-w.3 起，2026-09-23 重烤一次）：点击队列三步「余额卡 → 随机语句(48 句) → 图片/动图」，分组 A=[其余点击泡 + **当前配置里已有的自定义泡**] / B=[q0,usageToday,usageMonth] / C=[alert,budget,turnCost,holidayStale,valleyEnd,peakLock]，**组权重 A=5 / B=10 / C=5**，常驻=无，轮播=3 秒 + **顺序轮播**，逐颗开关全开、**`dshwWEntryW={"q1":2}`**、**打标 `{"f0":["deepseek"],"f1":["zhipu"]}`**、**重命名 `{"usageToday":"deepseek用量明细·今日用量","usageMonth":"…本月用量"}`**、**安排记录 `{"f0":"A","f1":"A"}`**，生态 deepseek、**联锁默认勾上（`ecoLock:'1'`）**，校准阀值 90。自定义泡的 id 按**现有目录**取（`wGroupDefaultGroups()` 里 `wGroupCatalog()` 过滤 `free`），全新安装没有自定义泡时就是空数组，不会写出指向不存在的 `f0`。
- 基线常量：出厂点击队列 = `BUBBLE_DEFAULT_ITEMS`（已按上面那份重新固化，旧的并列 A/B 出厂泡不再出现在默认里），其余 = `wRestoreDefaults()` 上方的 `W_BASELINE`。**两处要一起改**；重烤后记得同步 README-W §一 那段与 DEV-NOTES 本节（组权重写在 `wGroupDefaultGroups()` 里，不在 `W_BASELINE`）。
- W 面板重置：常驻勾选、轮播秒数与方式、峰谷开关、组管理（回上面三组含权重）、逐颗开关与权重、打标、条目重命名、条目安排记录、生态与联锁、校准阀值。
- 原版面板重置：大小 1.0 / 音量 0.9 / 音效组 duck / 泡泡开关开 / 每轮消耗开+自动关 5 秒 / 滚动避让关+17px / 菜单按钮隐藏关。
- **不碰内容**：① 点击队列、模块字号、图片显示大小、自定义泡（0.3.5-w.3 曾把出厂队列也写回去，结果把用户自己调过的泡的大小一起抹了，已回退）；② **触发泡自定义文案与模块字号 `dshwWTrigMods`**（同一类误伤，用户第二次反馈后从 `W_BASELINE` 里移出）—— 要重置某条去它的编辑器里点「恢复默认」，要重置整条队列用「泡泡管理 → 重置」。
- **不碰**：余额与用量记录、挂件位置记忆。
- ⚠ 每个 W 键都必须**显式写回基线值**，不能 `removeItem`：宿主镜像是按键合并写的，键缺席会保留住旧值，恢复默认就传不到别的浏览器（`dshwWTriggers` 由 `dshwTrigSave()` 写，不用手动）。
- 实现：`assets/whale-widget.js` 的 `wRestoreDefaults()`。

## 8. 配图清单（docs/）

| README-W 占位 | 内容 | 状态（2026-09-23） |
|---|---|---|
| 1 `screenshot-w-panel.png` | W 面板总览 | ✅ 已放 |
| — `screenshot-persist-dropdown.png` | 常驻分组下拉展开 | ✅ 已放（新增，不占编号） |
| — `screenshot-eco-dropdown.png` | 生态下拉展开（智谱/千问占位） | ✅ 已放 |
| — `screenshot-original-menu.png` | 原版主菜单 | ✅ 已放 |
| 2 `screenshot-group-manage.png` | 组管理三组 + 未分配组 | ✅ 已放 |
| — `screenshot-group-entries.png` | 展开某组：逐颗开关 / 权重 / ✎ / ✕ | ✅ 已放 |
| — `screenshot-entry-settings.png` | ✎ 显示设置面板（名称 / 打标 / 联锁放行提示） | ✅ 已放 |
| — `screenshot-bubble-manage.png` | 泡泡管理 · 点击顺序视图 | ✅ 已放 |
| 3 `screenshot-persist.png` | 常驻泡悬浮效果 | ✅ 用 `screenshot-usage-month.png` 顶上（那张就是常驻泡在鲸鱼头顶的实拍），不再单拍 |
| 4 `screenshot-usage-month.png` | 本月用量明细泡（绿灯 + 红色加价） | ✅ 已放（§三、§四 共用） |
| — `screenshot-dsh-token-panel.png` | DSH 自带 Token 用量面板（§四"前端"数据源对照） | ✅ 已放 |
| — `screenshot-plugin-install-ui.png` | 设置 → 插件 → 插件管理（§七 方式三） | ✅ 已放（换成用户给的大图） |
| 5 `screenshot-tampermonkey.png` | Tampermonkey 脚本安装页 | ✅ 已放（v1.0.2） |
| — `screenshot-token-sync-console.png` | platform 页控制台两行 `[dsh-whale]` 日志 | ✅ 已放（DeepSeek 埋点行含 `user_unique_id`/`web_id`，**已整行抹白**） |
| 6 `screenshot-peak-lock.png` | 峰时锁定 | ➖ 不放（用户定：没必要） |
| 7 `screenshot-trig-edit.png` | 触发提醒编辑窗口 | ➖ 不放（同上） |

**截图打码流程**（下次补图照做，脚本在 `%TEMP%\readme-preview\crop.js`，纯 `pngjs` 无原生依赖）：`node crop.js 输入 输出 mask x y w h 底色` 覆盖矩形、不带 `mask` 参数则是裁剪。定位办法：先按颜色阈值扫出目标块（比如 DevTools 的黄色告警底 = `R>225 && G>215 && B<190`）拿到精确行列，再遮；**遮完一定要把结果裁出来用眼睛复核**，边缘残留很常见（这次 `¥` 就露过一次）。底色取周围像素色才不会看出方块。用户口径：**账号余额这类可见数字不用遮，只要不漏标识符/密钥类信息**；README 图注里已写明"发布前检查是否含账号/密钥信息"。

⚠ 截图放进来之前先查 **PNG 元数据**（`tEXt`/`iTXt` 里常带作者名、生成工具、绝对路径），必要时剥掉再发布 —— 素材口径见 PROVENANCE.md。11 张已全部扫过，无文本块。
⚠ 对外文档里**不要写"气泡带尾巴两个小点"这类观感描述**（2026-09-23 用户明确：那是他的个人喜好改动，不是功能点）；同理"同形同位"这种实现口吻也改成中性说法。

## 9. 待办

- [x] ~~验收演示完成后 git 提交 + 打 tag~~ → 2026-09-23 已发：`main` + `whale` 分支 + tag `v0.3.5-w.3` + Release
- [x] 配图补齐（2026-09-23）：docs/ 共 13 张，含油猴安装页与同步成功控制台图；§五/§六 按用户意见不放图
- [ ] **GitHub 首屏用哪份 README 待定**：现在 `main` 根 README 是"插件集合"目录页，`whale` 分支根是 README.md（上游口径 + W 横幅）+ README-W.md（W 版详解）
- [ ] **修 `scripts/sync-branches.mjs`**（新克隆上必失败，见 §15）
- [ ] 恢复默认基线是否按"常驻只勾 B"的最新状态再烤一次（当前基线是常驻=无）—— 等用户点头
- [ ] 峰谷假时间线重做与测试（方案见第 3 节）
- [ ] 观察「今日」官方用量数据是否长期返回空（第 4 节第 6 条）
- [ ] 智谱 / 千问生态面板（现为空白占位）
- [ ] **跟宿主到 0.1.6-alpha 及以后时要回归的清单**（官方 Releases 原文里的插件相关改动，rc 线还没有）：① 插件依赖改「运行时解析」(alpha.1) —— 我们的 `link:` 安装与 `main: lib/index.js` 解析路径要重验；② 新增插件管理页 + 实时启停 (alpha.2) —— README-W §七 教的手改 `cordis.patch.yml` 会被 UI 取代；③ 「设置改由当前 Profile 的插件配置保存」「Agent 预设改由插件组合包声明安装」(0.1.7-alpha.1)；④ 插件可用 locale 数据结构声明多语言标题/描述、patch 组合包按顺序加载 (0.1.7-alpha.1)；⑤ 「修复 Web 服务重启后显示已连接却无法继续显示回复」(0.1.7-alpha.2) —— 与本挂件的重连/常驻刷新有关，重启 dsh 后要看一眼气泡有没有复活。
- [ ] 宿主 `0.1.5-rc.3` **官方没有 Release Notes**（npm 09-22 发，GitHub Releases 最新只到 rc.2）；`@latest` 装法会让 cordis 漂到 4.0.4 导致 `dsh web` 起不来，官方在 `0.1.7-alpha.2` 才把 vendor 包自动更新收紧到补丁版本 —— 也就是说这个坑是已知的，收紧之前**必须用 `@next` 或显式 `@0.1.5-rc.3`**。

## 10. 上游 0.3.6 → 0.3.9 对照（2026-09-22，用 npm 上的 0.3.5 与 0.3.9 做纯上游 diff：宿主 20 hunk / 前端 68 hunk）

| 上游版本 | 改了什么 | 我们这版的状态 |
|---|---|---|
| 0.3.6 | **新版 DSH 上挂件完全不初始化**（issue #123：0.1.6-alpha.1 起 composer 是 `contenteditable="false" role="textbox" data-composer-input`） | **已移植** `dshwIsChatRoot()`（前端文件头）。本机 dsh 还是 0.1.5-rc.1 所以没暴露，别人用新版会踩 |
| 0.3.6 | Codex 本机统计同步扫描会冻结事件循环 + `ERR_STRING_TOO_LONG` 永久复发（issue #116）→ 改异步 + 单文件 32MB 上限 + 单轮预算 + 每文件让出事件循环 | **已移植**（宿主）：`codexScan()` 全程 `fs.promises` + `CODEX_MAX_FILE_BYTES/预算/deferred`，调用方一律走快照 `codexSummaryCached()`，不再触发同步扫描 |
| 0.3.7 | 复查 0.3.4~0.3.6 带出的 6 处隐患（孤儿元素、连接检查兼容、选择器过宽、配置时序、过期缓存、自引用死循环） | 我们基线在 0.3.5，多数隐患不适用 |
| 0.3.8 | **DOM 挂载/孤儿节点治理**：新增 `dshwBodyNodes` 登记 + `dshwBodyDetach()`，SPA 整体替换 body 时统一补挂（v743），关闭浮层一律走 detach 而非 `removeChild`（否则被守护补挂回来 → toast 永不消失，v744）；z-index 分层表（v748） | **已移植**：机制随补丁进来（`dshwBodyAppend` 33 处 / `dshwBodyDetach` 11 处），并把 W 自己新增的 4 个 body 节点也接上了 —— 常驻泡本体、常驻勾选菜单、`wMiniPanelPlace` 小面板（含旧面板清理与点外关闭）、以及它们的移除路径。现在文件里除 `dshwBodyAppend` 内部那一处外，没有裸的 `document.body.appendChild/removeChild` |
| 0.3.8 | 音效引擎重做（v745：预解码 + 同步起播 + `RELEASE_LEAD_MS` 可调衔接，找回 0.3.3 之前"贴手"的手感） | **已移植**（随前端整份 diff 进来，含按压/松开与音效编辑器预览三处） |
| 0.3.8 | 峰谷补「法定节假日全天谷价」+ 宿主 `nextPeakChangeAt()` 下发切换点 | **已合并成一份表**：删掉上游自带的平铺 `HOLIDAY_VALLEY` 与同名 `isHolidayValley(bjDate)`（它会覆盖我们按秒签名的版本、静默失效），改由我们的年分键表 `HOLIDAY_VALLEY_DAYS` 经 `holidayValleyDaysFlat()` 摊平出 `HOLIDAY_VALLEY_LIST` 下发。前端 `bubbleCountdownNextChange()` 已接上「优先用宿主 `state.peakNextChangeAt`」+ 本地扫描 8→12 天。行为已测：国庆/中秋/周日 10:00 均为谷、周二 10:00 为峰、下一切换点 9/22 12:00 正确、清单 33 天 |
| 0.3.9 | Codex 统计默认关（没配 Codex 模型就不扫）+ 开关挪进 Codex 模型设置子菜单 + 修 toggle 后模型列表不刷新 | **已移植**：`hasCodexModel()` 默认关、`codexInvalidate()`（写 size 配置后立刻失效，否则开关看起来没生效）、设置菜单里原地刷新用量行 |

移植方法：`patch --fuzz=3` 把上游整份 diff 打到我们文件上（前端 66/69、宿主 18/20 自动命中），失败的逐个手工补。**打完必须做两件检查**：① `node --check`；② 查"半应用"——上游 h16 失败导致 `writeSizeConfig` 里已有 `codexStatsOnArg` 的用法但签名没这个参数，直接调用就会 ReferenceError；同类问题用「新增标识符是否有定义」的符号扫描兜住。

复查方法（下次上游再更新照做）：`npm pack dsh-whale-widget@<旧基线> dsh-whale-widget@<新>` → 解包 → `diff -u` → 用「旧代码行在我们文件里唯一命中」筛掉 `document.body.appendChild(mask)` 这类通用行的误报。

## 11. 发布前审查记录（2026-09-22，两路只读子代理：功能与冗余 / 安全与隐私）

**安全侧已修**（改的都是宿主 `lib/index.js`，需要重启 dsh 才生效）：

1. `JSON_HEADERS` 去掉 `Access-Control-Allow-Origin: *`（§4.16）。
2. 平台令牌端点 Origin 改精确比对 + 预检也过校验 + 只回显命中的 Origin（§4.5）。
3. `dshwvToast` 改纯文本渲染（§4.17）——原先两处调用会把宿主错误串当 HTML 拼进去。
4. 宿主 W 设置改按键合并写，形状不合法的键保留镜像里上一份好的（§5）。

**安全侧刻意保留**（都有理由，别当漏网之鱼）：

- **自定义模型的「凭据名」是自由文本**，`set-key/delete-key` 直写 DSH 凭据库同名条目，运行时按 `keyRef` 解析后发给用户自己填的 Base URL。这是上游「接第三方厂商」功能的设计前提，收紧白名单会让 `OPENROUTER_API_KEY` 这类正常填法失效。防线是：同源 + 信任栅栏 + 现在没了通配 CORS，且唯一的 HTML 注入点（第 3 条）已封。**给用户的话写在 README-W「数据与隐私」：凭据名只填自己新建的，别复用别的服务的名字。**
- `.dshw-usage.json` 里 `sha256(API_KEY)` 前 24 位：上游记账内核用来分账户的不可逆指纹，只在本地文件里，不外发。
- Codex 摘要里的 `home` 字段（含用户名的绝对路径）：前端从未读取，也不出本机。
- `rejected()` 在 `connection` 服务缺失时 fail-open：`inject` 已声明该依赖，服务缺失时插件根本起不来，这条分支实际不可达；改成 fail-closed 反而会在 dsh 升级中把挂件整体打死。

**功能侧已修 8 项**：① 自愈写不再置 `wSettingsDirty`（§4.9④）；② `wGroupRender` 的剔除/回迁加 `bubbleCfgArrived` 闸门（§4.10）；③ 出厂归属按「默认目录位置」查组，此前首颗余额泡会被认进 A 组、和出厂规则相反；④ 删除按钮的待删列表改取 `wGroupQueueSteps()`（§4.13）；⑤ 编辑器开着时禁止删泡（§4.14）；⑥ `HOLIDAY_VALLEY_FROM_SEC` 接进 `isHolidayValley()`（§6）；⑦ 年度「表过期」红条补上开关与「仅 DeepSeek」门控，和触发泡同一口径；⑧ 前后端组结构校验对齐（`g.id` 必须是字符串）。

**没修**：上游自带的 12 个零引用函数与 2 个未用变量（§4.15，为逐版 diff 干净）；节假日三份清单收敛成一个 `dshwHolidayDays()` 取值链（宿主两处下发本是同一张表，前端不再各查各的）。

**待用户手动复验**（宿主改动要重启 dsh，本轮按用户要求没有占用 3080）：换浏览器恢复 W 设置、平台令牌同步（油猴脚本推送后指示灯能变绿）、删气泡后各组编号不错位、峰时锁定与谷时提醒。

**审查之后用户实测发现的（19）**：W 面板所有下拉点开都没反应 —— 根因见 §4.18（`visibleTopZ()` 引用了不存在的 `usageMask`，异常被 `dshwDropOpen` 的外层 try 吞掉，层级那一行没执行，弹层停在 z-index:60 被盖住）。这条**上游 0.3.9 里同样存在**（那边 `dshwDropOpen` 也一样调 `visibleTopZ()`），我们的版本是因为把常驻菜单/✎ 小面板改走 `dshwBodyAppend` + 弹层定位才暴露出来。修法：候选表里那个幻引用改成 `typeof` 守卫 + 两处落层各自 try 兜底 26010。验证方式（自动化浏览器里跑真实事件序列 pointerdown→…→click，读 `[data-dshw-persistmenu]` 的计算样式）：修前 `z-index:60`、修后 `26010 > 菜单 10000`，4 个选项都在。**只用 Ctrl+F5 即生效**（纯前端）。

### 11.1 同日第二轮（用户实测提的三件事）

1. **两处删除入口同步**：新增 `wGroupsResyncAfterSave(旧序列, 新序列)`，挂在 `saveBubbleCfg` 落盘成功的唯一出口上，用内容签名（第二轮按剩余位置顺序兜底）把组归属/逐颗开关/逐颗权重/安排记录搬到新序列上 → 「泡泡管理初始面板删一步」和「组管理真删」从此同口径，拖动换序也让归属跟着泡走（§4.2）。组管理删泡与恢复默认两处传 `skipGroupResync=true` 避免二次位移。单测 11 例（`删中间步/换序/只改内容/新增/并列泡摊平` 后四张表的状态）全过。
2. **DS 门控扩展到点击序列泡**：`wEntryDsOnlyGated()` 现在对 `q*` 编号做**内容判定**（模块含 `random/image/randimg` → DS 绑定），不写死 q1/q2；`bubbleShowSeqNext` 也过 `wDsGateOk`（原先只管常驻）。✎ 面板对点击泡给出「编辑内容/样式」→ `openBubbleItem(idx, side)`。当前配置下 q1(随机语句)/q2(图片) 被门控、q0(余额卡) 不受影响。
3. **恢复默认的基线**：`BUBBLE_DEFAULT_ITEMS` 重新固化为线上那份三步队列（余额卡/随机语句/图片动图，旧的并列 A/B 出厂泡不再进默认，文件顺带瘦了 24KB），`bubbleDefaultSecondModules()` 改成并列泡与摊平两种形状都认（否则随机语句池会退回 20 句老池）；基线常量集中在 `W_BASELINE`，每个 W 键**显式写基线值**而不是 removeItem（宿主改成按键合并写之后，删键会被镜像里的旧值顶回来，恢复默认就传不到别的浏览器）。**但恢复默认不碰泡泡内容**（见 §7，这条是同日回退的）。

### 11.2 同日第三轮（用户实测：常驻计时 + 上传）

- **常驻文本泡 1 秒一切（轮播设的 3 秒不生效）**：渲染随机语句时 `bubbleContentLineOf` 会把抽到的下标写回模块对象（`mod._lastPick`，防重复抽同一句），而常驻泡直接拿 `bubbleCfg.items[].modules[]` 本体渲染 → 内容签名 `wPersistSigOf` 每秒都变 → 每秒重建+重抽。GIF 那颗没有随机模块，签名稳定，所以能按 3 秒完整放完 —— 症状的不对称就是这么来的。修法：常驻渲染改用 `wPersistModsViewOf(it)` 的**深拷贝**，键里带 `wPersistLastRot`（一次轮播内不换句，换颗才重抽），签名继续读原始 mods。实测（隐藏标签页里手动按 1.2s 节奏 tick）：0ms → 3601ms 才换，中间两次保持同一颗。
- **图库上传传不上去**：用户拿一张 9.5MB 的大 PNG 试上传，被两道上限挡掉 —— 宿主请求体 10MB（base64 膨胀 4/3 后约 13MB 直接超）+ 解码后 8MB 上限，而且前端任何一步失败都只 `cb(false)`，用户看不到原因。当时：上限提到 16MB（请求体 24MB），前端先按 `file.size` 拦一道并给具体文案，宿主错误原样 toast 出来；顺带把 jpg 放进来（`accept` 加 `image/jpeg`、宿主认 `jpe?g`、`bubbleImgMime()` 统一出 Content-Type），不用再靠改后缀。**随后又提到 32MB / 请求体 48MB 并加了自动压缩**，见 §13。

## 12. 生态 ↔ 角色 ↔ 模型 的内置联动（2026-09-22，无开关）

四条规则（用户拍板，做成内置行为，**不加设置项**）：

1. 「配套生态」选智谱 → 角色自动换成 `Z狐`；选千问 → `千问`；选回 DeepSeek → `小鲸鱼`。**按角色名匹配**（`DSHW_ECO_ROLES`），因为角色 id 是导入时随机生成的（`role_muc8fmh5_*`），只有名字稳定；用户没导入过该名字的角色就只换面板、不动皮肤。
2. DSH 模型选择器切到 `glm*`/`zhipu*`/`qwen*`/`tongyi*` → 生态跟着切（角色再由第 1 条带上）。判定源是宿主 `last-turn.json` 的 `activeModel`，在 `pollLastTurn` 里发现模型变了才动一次。映射函数 `wEcoOfModel()`。
3. **反向不成立**：切生态绝不写模型选择器（挂件也没有那个能力）。
4. 手动点角色 = 只换皮肤，不改生态也不改模型。所以**启动时只恢复生态面板、不强制改角色**（否则会把用户故意换的皮肤按回去）；`dshw-role` 仍留本机 localStorage，不进镜像。

实现点：`assets/whale-widget.js` 里 `DSHW_ECO_ROLES / wEcoOfModel / wRoleByName / wEcoSyncRole / wEcoSet`（紧挨生态下拉）；生态值存 `dshwWEco`（裸字符串，第 11 个 W 键，宿主 `W_SETTINGS_VALID` 已加枚举校验）；`wRestoreDefaults` 里 `wEcoSet('deepseek', false)` —— 生态回默认但不动皮肤。

验证（临时实例 3081，改下拉后读角色按钮文案）：`deepseek/小鲸鱼 → zhipu/Z狐 → qwen/千问 → deepseek/小鲸鱼` 全对，`dshwWEco` 落盘正确；模型→生态那条只跑了 `wEcoOfModel` 的 11 例映射单测（要端到端得真去切 DSH 的模型，会写用户的 `settings.yaml`，没动）。

### 12.1 气泡打标 + 生态联锁（同日追加，也是内置无开关）

- 「生态」下拉 + 同行右侧「联锁」勾选框放在**面板最底行**（「◂ 原版」下面）；用户先要顶部、后又改到底部，位置只由 `wAcctRow` 的 append 顺序决定（现在就是 wView 的最后一个子节点）。
- 每颗泡的「✎」现在**统一**先进「显示设置」：第一项是打标**多选勾选面板**（`无 / DeepSeek / 千问 / 智谱`，样式同「常驻」那个），点按钮就地展开勾选列表，下面是「编辑内容/样式」。**「仅 DeepSeek 模型时显示」逐条勾选已删**（与联锁重复），改成内置规则 `wDsGateOk(id) = !(标集恰好只有 deepseek 一个 && 当前模型非 DeepSeek)` —— 同时勾了别的生态标 = 用户声明那个生态也能用，就不拦。
- 门控只有一处：`wEcoLockOk(id)` —— 联锁关 = 全放行；开 = **标集为空（「无」）永远放行**，否则要求标集包含当前生态。接进 `wEntryLive`（常驻池）与 `bubbleShowSeqNext`（点击序列），改标/改锁/改生态都走 `wEntrySwitchRefresh()` 立即重算。
- **推导标** `wEntryTagsDefault(id)`：`wEntryDefaultsToDsTag(id)`（原 `wEntryDsOnlyGated`，含义改成"默认该打 DeepSeek 标"）→ `['deepseek']`；其余 → `[]`（无）。所以余额卡、用户自建的图默认都是「无」= 联锁不管它们。
- 实测：单测 20 例（含用户举的例子：勾 DeepSeek+千问 → 在 deepseek/qwen 生态都在、切到 zhipu 消失）；真实页面里 ✎ 面板按钮显示推导值 `DeepSeek`，展开后 4 个勾选框（无/DeepSeek/千问/智谱）状态正确。
- ⚠⚠ **测试浏览器会通过镜像污染用户设置，已经踩过两次**：3081 测试页的 localStorage 会跨会话残留（旧语义的标、被点过的联锁/生态），一次 `wSettingsPush()` 就把它整包推 into `.dshw-w.json`，用户浏览器随后 hydrate 就中招。第二次连 `dshwWPersistGroups` 都被推成 `{}`（常驻全取消）。**规矩：在临时实例上做完任何写类操作，结束前必须把镜像 diff 一遍再收工**（`node -e` 对比 `Object.keys` 与关键项），或者干脆只做只读观察。备份留在 Temp：`dshw-w.before-untag.json` / `dshw-w.polluted.json`。
- ⚠ 这两个 catch 以前是纯静默的（`catch (err) {}`），排查"点了没反应"时什么都看不到；现在都会 `console.error('[dsh-whale] ...')`。同类还有 `dshwDropOpen`（见 §4.16/18）。

## 13. 图库上传自动压缩静态图（2026-09-23）

`dshwPrepareUpload(file, cb)`（`assets/whale-widget.js`，紧挨 `bubbleUploadImg`）在**浏览器本地**把静态图压完再走原来的上传链路，`cb(out, note)`：`out` 是传给 `FileReader` 的 `File`/`Blob`，`note` 是要 toast 给用户的人话（`已自动压缩：9.5MB → 768KB，尺寸 4320×4504 → 767×800`）。

规则（顺序即判断顺序，**每一条都退回原文件，绝不因为压缩失败而拒收**）：

1. 只认 **PNG / JPEG 魔数**（`89 50 4E 47` / `FF D8`）。WebP 可能是动图，不看魔数一律不碰；GIF 更不用提。
2. PNG 再过一遍 `dshwAnimLoopMs(b)`（§4.19 那套动图一圈时长解析）—— **APNG 是 PNG 壳的动图**，一眼看扩展名看不出来，识别到多帧就原样上传。
3. `file.size <= 600KB`（`DSHW_IMG_NO_COMPRESS`）直接放过：本来就不大，别白重编码一次画质。
4. `Image` + `canvas`：最长边超过 `DSHW_IMG_MAX_EDGE = 800px` 就等比缩；`toBlob` 时 **PNG 仍转 PNG**（贴纸类图基本都带 alpha，转 JPEG 会糊出白底），JPEG 用 `0.9` 有损。
5. 压完**不比原图小就丢回去**（小图重编码常常反而变大），任何一步抛错/`onerror` 也都 `done(null, null)` → 传原图。

上限随之抬高：前端 `DSHW_IMG_MAX_BYTES` = 宿主 `BUBBLE_IMG_MAX_BYTES` = **32MB**，宿主请求体 `readBodyMax` = **48MB**（base64 膨胀 4/3，32MB 原图 ≈ 43MB 请求体）。**动图不压缩**，所以 32MB 的 GIF 还是会撞上限 —— 文案里已经写明"动图不压缩，只能自己先压一下"。

为什么在前端压：宿主拿到的已经是 base64，再解码重编码等于把同一张图过两遍，而且渲染端要的是小图（图库里每张泡每次渲染都要解码），上传前压一次最省事。

验证（临时实例 3081，跑用户自己图库里那张 9.5MB PNG 走完整链路）：`{"原图":"9.50MB","尺寸":"4320×4504 → 767×800","压缩后":"768KB","缩小倍数":"12.7x"}`。⚠ 动图（GIF/APNG）与 ≤600KB 的小图只跑了代码路径推理，没真上传——测试期不做破坏性写入（§12.1 那条规矩）。

## 14. 发版前第四轮审查（2026-09-23，三路子代理 + 逐条核实）

**先记方法论**：三个子代理（功能/冗余/安全）一共报了 30 余条，**逐条回源核实后**：功能 5 条真、1 条误报（`wPersistTick` 的 `root` —— 2710 那处本来就有 try 兜底，同函数同一元素不会为空）；安全 4 条真、2 条低危不修；冗余/文档 9 条真。**子代理会把"注释里没写"当成"代码没做"**（比如 §4.12 早就写明六处表，代码其实漏了 `dshwWEntryTag` —— 结论对，理由说反了），所以每条都要自己看行号。

已修（按影响排序）：

1. **jpg 存进去读不出来**（功能 + 安全同时命中）：上传按 `id + '.' + format` 落盘，但**读取和删除都写死了「不是 gif 就是 png」**，图库列表也把 format 归一成 png —— 于是 jpg 上传成功、索引里有、图片永远 404，删除还会留孤儿文件（`unlinkSync` 找不到 `.png` 被静默吞掉）。新增 `bubbleImgExt()` 统一出扩展名，三处（serve / delete / payload）全改走它。**真机往返验证**：故意把 canvas 生成的 JPEG 用 `data:image/png;base64,…`（假 MIME）上传 → 宿主 `storedFormat: "jpg"` → 取图 200 + `image/jpeg` + 头两字节 `ffd8` → 删除 200 → 再取 404（证明 `.jpg` 文件真被删了，不再留孤儿）。
2. **宿主改成按魔数定格式**：`sniffImageFormat(buf)`（PNG `89 50 4E 47` / JPEG `FF D8` / GIF `47 49 46`），对不上就 400 并说明"可能被改过后缀"。前端 `dshwPrepareUpload` 的**放行分支也补了 `typed()`**：`readAsDataURL` 的 MIME 是按**扩展名**给的，改过后缀或无后缀的文件会带着错类型入库，现在按已读到的字节重包一层 Blob。上一条那个假 MIME 用例就是踩这条路。
3. **`wGroupsRemapIds` 漏了打标表**：删一步/塌并列之后 `dshwWEntryTag` 不跟着挪 → 生态联锁会把标打在错的泡上（该藏的泡冒出来、该冒的被藏）。补 rekey，注释与 §4.12 对齐成六处；顺手把那个 `catch (err) {}` 改成 `console.error` —— 静默失败会留下"表只改了一半"的状态，比不改更糟。
4. **删泡 POST 失败不回滚**：原来是「先重映射本机六张表 → 再 POST 泡泡配置」，POST 挂了本机表已经错位而服务端没变。新增 `wEntryTablesSnapshot()/wEntryTablesRestore()`，失败时整批还原 + 重渲染 + 提示重试。
5. **生态联锁漏了 6 个弹泡入口**：`wEcoLockOk` 原先只接在常驻池与点击序列，`余额预警/今日预算/每轮消耗/年表过期/谷时将尽/峰时锁定` 只过 `wDsGateOk` → 联锁开着、生态切到千问，这些 DeepSeek 标的泡照弹，与 README 的承诺相反。六处补齐（结构核对：现在每个 `wDsGateOk` 调用点都并了 `wEcoLockOk`）。
6. **平台令牌路由只校验了来源，没校验 method**：不带 Origin/Referer 的任意方法都能落到写入分支。加 `POST` 限定（405 + `Allow`）。原有加固确认在位：精确 Origin 比对、带来源头但不匹配一律 403、无 CORS 头、载荷要过 `normalizePlatformToken` 且 ≥40 字符。
7. **令牌/注册表落盘权限**：16 处 `writeFileSync` 全不带 mode，POSIX 下 0644 → 同机其他账号能读平台 JWT。新增 `writePrivate()`（`mode:0o600` + 再 `chmodSync`，因为 mode 只在创建时生效），用在平台令牌与 `.dshw-api.json` 两处。Windows 上无实际变化。
8. **凭据名放开字符集 = 可以构造 YAML 键**：`set-key`/`delete-key` 的 `keyRef` 原来只 trim 判空，能写出带空格/换行/冒号的键去动别人的条目。改成 `^[A-Za-z0-9_.\-]{1,64}$`（命名约定本来就是大写蛇形），报错文案带允许字符。
9. **SSRF 只挡首跳**：`apiFetchJson` 是**唯一带用户密钥外发**的请求，`fetch` 默认跟重定向 → 公网域名 302 到 `169.254.169.254` 就能把 key 带出本机。改 `redirect:'error'` 并给"请把 Base URL 填成最终地址"的提示。**刻意保留**的设计（见 2030 行注释）：不拦回环与内网，因为 ollama/自建网关模板就推荐 `http://127.0.0.1:11434/v1`。
10. 文档：`package.json` 的 `files` 补 `PROVENANCE.md`；README.md 两处指向不存在的 `whale-widget-prompt.md` → 改指 DEV-NOTES，顶部加「本目录是 W 魔改版」横幅；README-W 的 A/B 并列泡说法改准（**出厂默认**移了，编辑器仍能自己拖并列）；FAQ 那条「在 ✎ 里关掉」重写（勾选框已删，给三种放行方式）；§3 里"下次确认 `fakeTimeline` 钩子存在"改成"该钩子已随方案删除，别按旧名找"。
11. **触发提醒的「启用」开关合并（用户拍板：功能重了，留一个）**：编辑器「触发条件」区原来有个启用框，写的是 `dshwTrigCfg.peak/valley/holiday` —— 和 W 面板峰谷区那两个勾是**同一份状态**（还做了双向同步），而组管理每颗泡行首的勾写的是 `dshwWEntryOff`，**只影响常驻池与点击序列、根本不管弹不弹**。所以：删掉编辑器里的启用框（`bubbleTrigChk/bubbleTrigLb/bubbleTrigSeg` 三个节点与 change 监听，「触发条件」区只留一句说明 + 指向行首开关）；同时给三条触发泡的弹泡判定和年表过期红条各加 `!wEntryIsOff(id)`，让**行首开关成为这颗提醒的唯一开关**。语义分层现在是：W 面板峰谷勾 = 功能总开关（峰时锁不锁发送按钮）；行首勾 = 这颗泡弹不弹 + 进不进常驻；`holidayStale` 没有 W 面板勾，全靠行首开关（删框前它是唯一开关，不加这一步就没法关了）。⚠ 这三处判定在 `dshwTrigEvaluate`（14210+）与红条（17860+），以后再加提醒出口记得同样带上 `wEntryIsOff`。
12. **指示灯看的是本机令牌文件，不是油猴脚本**（用户实测困惑点）：`resolvePlatformToken()` 先读 `~/.dsh/.dshw-platform-token.json`，再退回 DSH 凭据 `DEEPSEEK_PLATFORM_TOKEN`；**把 Tampermonkey 里的脚本删掉，灯仍然是绿的**（本机还存着令牌，前端 60 秒轮询一次）。要让它变灰只能删那个文件。对外文档别说"绿=脚本已启用"，要说"绿/黄=本机存有可用平台令牌"。
13. **⚠ 油猴脚本 1.0.1 是重写出来的，比 W2 那版差 —— 已回搬（1.0.2）**。用户当初的要求是**把 W2 的能力搬过来**，结果这里另搓了一版，还加进 `v.indexOf('ey') === 0` 的 JWT 前缀判据；平台现在的会话令牌是 **64 位不透明串**（`Bv…` 开头、无点号），真令牌被直接判成"没找到"，而且失败路径**一声不吭** → 症状就是"脚本装了、灯永远灰、控制台什么都没有"。1.0.2 以 `git show 6b9731b:dsh-whale-widget-w/assets/dsh-whale-token-sync.user.js`（W2 版）为基准搬回：7 个已知键 + `length>=40 && !/\s/` 判据 + 全量扫描只认 JWT 形态兜底 + 5 秒轮询 + `visibilitychange/focus` 补跑 + 加载横幅/来源 key/长度/被拒 HTTP 体/PNA 提示一整套日志 + `dshw-token-sync-endpoint` 覆盖端口；只保留 W3 该有的两点改进 —— 宿主注入的 `__PORT__`（W2 把 3080 写死）和 GM_xmlhttpRequest 优先、fetch 兜底。**教训：凡是"把 W2 某功能搬过来"的需求，先 `git show <W2 commit>:<路径>` 把旧实现拉出来逐行比对，能搬不重写；重写必须说清楚为什么重写、旧版的每一条判据在新版里对应到哪。** 验证：拿本机那份真实令牌跑判据，旧版 `★拒绝★`、新版通过。

**看过决定不改**（记下来免得下轮重复讨论）：
- 16 处 `error: String(err.message)` 会把含绝对路径的 fs 报错回显给页面 —— 接收方是**同一台机器上已过信任栅栏的用户自己的页面**，跨源读不到；换成一圈脱敏包装不值当。
- 48MB 请求体先整体转 utf8 再 base64 解码（峰值 ~130MB）：单机自用、且压缩后正常上传只有几百 KB，暂不改流式解析。
- `assets/rua.gif` 与 `assets/bubble-petpet.gif` **字节完全相同**（各 92KB）：都各有引用（前者是鲸鱼本体动图 `/dsh-whale/rua.gif`，后者是内置图库默认图），是上游素材，合并要动引用与 PROVENANCE，留给下个大版本。
- 触发条件判定在常驻池（`wEntryLive` 2348-2359）与弹泡评估器（14220+）各写一遍：语义不同（一个"该不该在池里"、一个"这一刻要不要弹"），合并会把两者耦坏。
- 上游死代码（`mkRow` 等 9 个、`bubbleDefaultQueue` 不可达旧体）：**按既定原则不删**（见 [[dsh-whale-widget-mod]]）。
- 未记入 §2 的 `__dshwRemindMask`/`__dshwLegacyPeak` 不是调试钩子，是浮层登记与跨脚本标志位，不需要文档化。

## 15. 发布流程实录（2026-09-23，W3 首次上 GitHub）

仓库 `WIMIN144/DSH`：`main` = 插件集合（子目录，**根目录没有 package.json，不能直接装**），每个插件的安装源是**自己的同名分支根目录**。发布步骤（本机这份源码目录无 `.git`，是纯工作副本）：

1. `git clone https://github.com/WIMIN144/DSH.git` → 在 `main` 上把 `dsh-whale-widget-w/` 整目录换成新构建（**`HANDOFF.md` 不发布**，它不在 `package.json` 的 `files` 里，拷的时候也别带上）。
2. `git add -A && git commit` → `git push origin main`。
3. `node scripts/sync-branches.mjs whale` → 把子目录内容发布到 `whale` 分支根并 push。
4. 安装 spec 已实测可解析：`npm install --dry-run github:WIMIN144/DSH#whale` → `add dsh-whale-widget-w 0.3.5-w.3`（走 https，不需要 SSH key）。

⚠ **`sync-branches.mjs` 有两个必踩的坑**（这次是绕过、没改脚本）：① 判断分支是否存在用的是 `git rev-parse refs/heads/<t>`，**只看本地分支** —— 新克隆里本地没有 `whale`，于是走 `git subtree split` 新建一条与远端无共同祖先的历史，push 必被拒 `non-fast-forward`（这就是历史上"在已有分支上必失败"的真因，上次改的是工作区处理，没改这个判断）。绕法：先 `git checkout -b whale origin/whale` 建本地跟踪分支再跑。② 脚本内部 `git commit` 依赖**全局 git 身份**，机器上没有 `~/.gitconfig` 就直接 `Please tell me who you are` 失败。绕法：`GIT_AUTHOR_NAME/GIT_AUTHOR_EMAIL/GIT_COMMITTER_NAME/GIT_COMMITTER_EMAIL` 四个环境变量传进去（不改用户配置）。正解是把 ① 改成同时看 `origin/<t>`、②给脚本加身份参数。

⚠ **卸载插件不会清 `~/.dsh/profiles/web/cordis.patch.yml` 里的入口**。残留一条 `{ id: dsh-whale-widget-w, … }` 之后，用插件管理器再装同一个 id 会报「与现有插件的入口 id 冲突（dsh-whale-widget-w），已自动回滚」—— 手工把那条删掉再装（README-W §七 卸载段已写明）。

⚠ **对比文件差异别用 `md5sum`**：clone 检出时 `core.autocrlf=true` 会把 LF 转成 CRLF，逐文件 md5 会"全部不一致"。要按内容比就用 `git hash-object <本地>` 对 `git rev-parse HEAD:<路径>`。
