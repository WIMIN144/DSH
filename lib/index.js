import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Package root: lib/index.js -> package root. Keeps the bundle relocatable
// when installed as a normal DSH npm plugin (node_modules or a local link).
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// DSH home: used for the widget size/usage memory files, since node_modules may
// be read-only or cleaned on update.
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

// Whale image: package-relative first, legacy absolute paths as fallback.
const IMAGE_CANDIDATES = [
  path.join(PACKAGE_ROOT, 'assets', 'DSniang1.png'),
  path.join(PACKAGE_ROOT, 'assets', 'DSniang02.png'),
  'D:/TestBox/deepseek/DSniang1.png',
  'D:/TestBox/deepseek/DSniang02.png',
  'D:/TestBox/deepseek/skin/DSniang02.png',
]

// Size memory file: prefer writable DSH home locations, then legacy fallbacks.
const SIZE_FILE_CANDIDATES = [
  path.join(DSH_HOME, '.dshw-size.json'),
  path.join(DSH_HOME, 'profiles', 'web', '.dshw-size.json'),
  'D:/TestBox/deepseek/.dshw-size.json',
  'D:/TestBox/deepseek/skin/.dshw-size.json',
]

// Token 用量统计账本（按 模型 × 今日/本月 分桶），挂件「用量」视图数据源
const TOKENS_FILE = path.join(DSH_HOME, '.dshw-tokens.json')

// 平台网页会话令牌的自动同步存储（官网页面上的油猴脚本推送到本地端点）
const PLATFORM_TOKEN_FILE = path.join(DSH_HOME, '.dshw-platform-token.json')

// Usage ledger file (小鲸鱼记账 mode): same policy as the size file.
const USAGE_FILE_CANDIDATES = [
  path.join(DSH_HOME, '.dshw-usage.json'),
  path.join(DSH_HOME, 'profiles', 'web', '.dshw-usage.json'),
  'D:/TestBox/deepseek/.dshw-usage.json',
  'D:/TestBox/deepseek/skin/.dshw-usage.json',
]

// Sound assets: package-relative first (ship Ya1/Ya2/D1/D2.mp3 in assets/ for
// sounds out of the box), legacy paths as fallback.
const SOUND_SETS = {
  duck: {
    press: [path.join(PACKAGE_ROOT, 'assets', 'Ya1.mp3'), 'D:/TestBox/deepseek/skin/Ya1.mp3'],
    release: [path.join(PACKAGE_ROOT, 'assets', 'Ya2.mp3'), 'D:/TestBox/deepseek/skin/Ya2.mp3'],
  },
  fx1: {
    press: [path.join(PACKAGE_ROOT, 'assets', 'D1.mp3'), 'D:/TestBox/deepseek/skin/D1.mp3'],
    release: [path.join(PACKAGE_ROOT, 'assets', 'D2.mp3'), 'D:/TestBox/deepseek/skin/D2.mp3'],
  },
}
function soundSetFromUrl(url) {
  try {
    const q = String(url || '').split('?')[1] || ''
    const m = /(?:^|&)set=([^&]+)/.exec(q)
    return m ? decodeURIComponent(m[1]) : ''
  } catch (err) { return '' }
}
const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const BALANCE_TTL_MS = 25000
const RUA_GIF_CANDIDATES = [
  path.join(PACKAGE_ROOT, 'assets', 'rua.gif'),
  'D:/TestBox/deepseek/skin/rua.gif',
  'D:/TestBox/deepseek/rua.gif',
]
// DeepSeek CNY prices per million tokens: [空闲时段价, 高峰时段价].
// 高峰时段：工作日 9:00–12:00 和 14:00–18:00（北京时间）；2026-08-23 起周末全天谷价。
// 2026-09-10 起 Flash 系列非高峰时段下调（W 魔改版已同步，价格页：
// https://api-docs.deepseek.com/zh-cn/quick_start/pricing）。
// Adjust here if DeepSeek changes pricing.
const PEAK_HOURS = [
  [9, 12],
  [14, 18],
]
const BASE_PRICE = { hit: [0.02, 0.04], miss: [1.0, 2.0], out: [4.0, 8.0] }
// deepseek-v4-pro 沿用官方 2026-08-17 档（官方公告：2026-09-14 12:00 起
// V4.1 Pro 上线前，deepseek-v4-pro 请求将路由到 V4.1 Flash 按 Flash 价计费）；
// vision-exp 与 flash 同价
const PRO_PRICE = { hit: [0.15, 0.3], miss: [4.5, 9.0], out: [13.5, 27.0] }
const PRICING = {
  'deepseek-v4-pro': PRO_PRICE,
  'deepseek-flash': BASE_PRICE,
  'deepseek-v4-flash-vision-exp': BASE_PRICE,
  'deepseek-v4-flash': BASE_PRICE,
  'deepseek-chat': BASE_PRICE,
  'deepseek-reasoner': BASE_PRICE,
  _default: BASE_PRICE,
}
function priceFor(model) {
  const m = String(model || '').toLowerCase()
  for (const key of Object.keys(PRICING)) {
    if (key === '_default') continue
    if (m.indexOf(key) !== -1) return PRICING[key]
  }
  return PRICING._default
}
// bucket time is an epoch second; derive the Beijing local hour to pick peak vs off-peak price.
// 2026-08-23 起（北京时间）周末（周六/周日）全天按谷价；生效时刻之前的历史
// 分桶仍按旧规则计价，所以周末判定带生效分界。
const WEEKEND_VALLEY_FROM_SEC = Math.floor(Date.UTC(2026, 7, 22, 16, 0, 0) / 1000) // = 北京时间 2026-08-23 00:00
function isPeakTime(timeSec) {
  if (!isFinite(Number(timeSec))) return false
  const n = Number(timeSec)
  const bj = new Date(n * 1000 + 8 * 3600 * 1000)
  if (n >= WEEKEND_VALLEY_FROM_SEC) {
    const dow = bj.getUTCDay() // 0=周日 6=周六（bj 按 UTC 读即为北京日历日）
    if (dow === 0 || dow === 6) return false
  }
  const hour = bj.getUTCHours()
  for (const [start, end] of PEAK_HOURS) {
    if (hour >= start && hour < end) return true
  }
  return false
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
}

const WIDGET_JS = `(function () {
if (window.__dshWhaleWidget) return
window.__dshWhaleWidget = true

var MIN_SCALE = 0
var MAX_SCALE = 2.5
var STEP = 0.1
var CLICK_SQ = 9
var REFRESH_MS = 60000
var CHANGE_MS = 900
var ANIM_MS = 700
var BUBBLE_MS = 5000
var FETCH_TIMEOUT_MS = 25000
var BALANCE_URL = '/dsh-whale/balance.json'
var SIZE_URL = '/dsh-whale/size.json'
var TOKEN_STATS_URL = '/dsh-whale/token-stats.json'
var IMG_URL = '/dsh-whale/image.png?v=2'
var GIF_URL = '/dsh-whale/rua.gif'

var css = [
  '.dshwv-root{position:fixed;right:0;bottom:0;--dshw-scale:1;--dshw-base:clamp(122px,calc(min(250px,min(100vw,100vh) * 0.28) * var(--dshw-scale)),625px);width:var(--dshw-base);height:var(--dshw-base);pointer-events:none;user-select:none;-webkit-user-select:none;z-index:9999;font-family:inherit;transition:left .16s ease,top .16s ease,transform .3s ease}',
  '.dshwv-root.dshwv-left{transform:scaleX(-1)}',
  '.dshwv-root.dshwv-dragging{cursor:grabbing;transition:none}',
  '.dshwv-body{position:absolute;left:0;top:0;width:100%;height:100%;transform-origin:50% 100%;transition:transform .22s cubic-bezier(.34,1.56,.64,1)}',
  '.dshwv-img{position:absolute;right:0;bottom:0;width:59.45%;height:59.45%;display:block;pointer-events:none;-webkit-user-drag:none;user-select:none}',
  '.dshwv-bubble{position:absolute;left:0;top:0;width:100%;aspect-ratio:1026/700;pointer-events:none;z-index:1;--dshw-u:calc(var(--dshw-base) / 1026);transform:scale(var(--dshw-bscale,1));transform-origin:43% 92%}',
  '.dshwv-bubble svg{display:block;width:100%;height:100%;pointer-events:none}',
  '.dshwv-bubble svg path,.dshwv-bubble svg ellipse{pointer-events:none;cursor:pointer}',
  '.dshwv-bubble.dshwv-bubble-open svg path,.dshwv-bubble.dshwv-bubble-open svg ellipse{pointer-events:visiblePainted}',
  '.dshwv-bubble .dshwv-bshape,.dshwv-bubble .dshwv-b1,.dshwv-bubble .dshwv-b2{opacity:0;transform:scale(.7);transform-box:fill-box;transform-origin:50% 50%;transition:opacity .2s ease,transform .2s ease}',
  '.dshwv-bubble.dshwv-bubble-open .dshwv-bshape,.dshwv-bubble.dshwv-bubble-open .dshwv-b1,.dshwv-bubble.dshwv-bubble-open .dshwv-b2{opacity:1;transform:none}',
  '.dshwv-gif{position:absolute;left:44.25%;top:38%;transform:translate(-50%,-50%);max-width:calc(var(--dshw-u) * 560);max-height:calc(var(--dshw-u) * 400);display:none;opacity:0;transition:opacity .2s ease;pointer-events:none;-webkit-user-drag:none;user-select:none;object-fit:contain}',
  '.dshwv-root.dshwv-left .dshwv-gif{transform:translate(-50%,-50%) scaleX(-1)}',
  '.dshwv-bubble.dshwv-bubble-open .dshwv-gif{opacity:1}',
  '.dshwv-bubble.dshwv-bubble-open .dshwv-b2{transition-delay:0s}',
  '.dshwv-bubble.dshwv-bubble-open .dshwv-b1{transition-delay:.13s}',
  '.dshwv-bubble.dshwv-bubble-open .dshwv-bshape{transition-delay:.26s}',
  '.dshwv-bubble .dshwv-bshape{transition-delay:.1s}',
  '.dshwv-bubble .dshwv-b1{transition-delay:.2s}',
  '.dshwv-bubble .dshwv-b2{transition-delay:.3s}',
  '.dshwv-text{position:absolute;left:44.25%;top:35%;transform:translate(-50%,-50%) scale(var(--dshw-fscale,1));text-align:center;color:#536ba9;line-height:1.15;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .16s ease,transform .3s ease}',
  '.dshwv-bubble.dshwv-bubble-open .dshwv-text{opacity:1;transition:opacity .16s ease .36s,transform .3s ease}',
  '.dshwv-root.dshwv-left .dshwv-text{transform:translate(-50%,-50%) scaleX(-1) scale(var(--dshw-fscale,1))}',
  '.dshwv-label{font-size:calc(var(--dshw-u) * 66);font-weight:600;letter-spacing:.06em}',
  '.dshwv-amount{font-size:calc(var(--dshw-u) * 128);font-weight:800;line-height:1.05}',
  '.dshwv-period{font-size:calc(var(--dshw-u) * 104);font-weight:800;line-height:1.05}',
  // 倒计时专用：等宽字体 + 常规字重，比第二行时段名小一号（时段名最大最醒目）
  '.dshwv-count{font-size:calc(var(--dshw-u) * 80);font-weight:400;line-height:1.05;font-family:ui-monospace,SFMono-Regular,Consolas,"Courier New",monospace;letter-spacing:.02em}',
  // 用量视图统计行：与模型行同字号（配合放大的气泡框使用）
  '.dshwv-stat{font-size:calc(var(--dshw-u) * 56);line-height:1.3}',
  // 用量明细美化：总计 hero 行（大号 token 数 + 加粗金额）+ 彩色圆点明细行（金额右对齐成列）。
  // 方案A（居中紧凑版，当前生效）：文本块 560u 居中——椭圆上下收窄，宽幅版会在底部顶到边框（已验证否决）
  '.dshwv-uhero{display:flex;align-items:baseline;justify-content:center;gap:calc(var(--dshw-u) * 16);margin-top:calc(var(--dshw-u) * 8);padding-top:calc(var(--dshw-u) * 8);border-top:1px dashed rgba(83,107,169,.35)}',
  '.dshwv-uhero .dshwv-utok{font-size:calc(var(--dshw-u) * 92);font-weight:800;color:#2c3f7d;line-height:1}',
  '.dshwv-uhero .dshwv-utok em{font-style:normal;font-size:calc(var(--dshw-u) * 44);font-weight:600;color:#8ba0d6;margin-left:calc(var(--dshw-u) * 4)}',
  '.dshwv-uhero .dshwv-ucost{font-size:calc(var(--dshw-u) * 60);font-weight:800;color:#203170}',
  '.dshwv-uhero .dshwv-ucost .dshwv-udelta{color:#e0433f}',
  '.dshwv-urow{display:flex;align-items:baseline;width:calc(var(--dshw-u) * 560);margin:calc(var(--dshw-u) * 6) auto 0;font-size:calc(var(--dshw-u) * 48);line-height:1.25}',
  '.dshwv-urow .dshwv-ulbl{font-weight:600;margin-right:calc(var(--dshw-u) * 10)}',
  '.dshwv-urow .dshwv-uval{font-weight:700;color:#2c3f7d;font-variant-numeric:tabular-nums}',
  '.dshwv-urow .dshwv-upct{color:#9fb0d9;font-size:calc(var(--dshw-u) * 40);margin-left:calc(var(--dshw-u) * 8)}',
  '.dshwv-urow .dshwv-ucost2{margin-left:auto;color:#536ba9;font-variant-numeric:tabular-nums}',
  // 恢复默认按钮：挂在避让滚动条行尾
  '.dshwv-reset{margin-left:auto;border:1px solid rgba(32,49,112,.4);background:#fff;border-radius:6px;padding:2px 8px;font-size:12px;color:#203170;cursor:pointer;flex:none}',
  '.dshwv-reset:hover{background:#203170;color:#fff}',
  // 常驻内容多选：按钮 + 勾选弹层
  '.dshwv-persist-wrap{position:relative;display:inline-flex}',
  '.dshwv-persist-box{cursor:pointer;text-align:left}',
  '.dshwv-persist-pop{display:none;position:absolute;top:calc(100% + 4px);left:0;background:#fff;border:1px solid rgba(32,49,112,.35);border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.16);padding:6px 9px;z-index:60;flex-direction:column;gap:5px;min-width:92px}',
  '.dshwv-persist-pop.dshwv-open{display:flex}',
  '.dshwv-persist-item{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:#203170;cursor:pointer;white-space:nowrap}',
  // 校准指示灯：标题行（今日用量/本月用量）右侧的小圆点，绿=已校准 黄=有未校准的新增量（仅前端+校正模式）
  '.dshwv-calib{position:absolute;left:calc(44.25% + var(--dshw-u) * 160);top:calc(35% - var(--dshw-u) * 178);width:calc(var(--dshw-u) * 34);height:calc(var(--dshw-u) * 34);border-radius:50%;transform:translate(0,-50%);display:none;box-shadow:0 0 calc(var(--dshw-u) * 14) rgba(0,0,0,.15)}',
  '.dshwv-calib.dshwv-calib-green{display:block;background:#2fa24c}',
  '.dshwv-calib.dshwv-calib-yellow{display:block;background:#e6b800}',
  '.dshwv-calib.dshwv-calib-gray{display:block;background:#9aa5b3}',
  // 用量视图放大气泡框：锚定根节点右侧（镜像时左侧），宽度 132%，鲸鱼本体不变
  '.dshwv-bubble.dshwv-bubble-big{width:132%;left:auto;right:0}',
  '.dshwv-root.dshwv-left .dshwv-bubble.dshwv-bubble-big{left:0;right:auto}',
  '.dshwv-wrap{white-space:normal;max-width:calc(var(--dshw-u) * 560);line-height:1.2}',
  '.dshwv-hint{font-size:calc(var(--dshw-u) * 56);color:#9fb0d9;letter-spacing:.02em;margin-top:calc(var(--dshw-u) * 9);min-height:calc(var(--dshw-u) * 64);line-height:1.15}',
  '.dshwv-menu-btn{position:absolute;top:calc(40.55% + 4px);right:4px;width:26px;height:26px;border:none;border-radius:6px;background:rgba(32,49,112,.85);cursor:pointer;pointer-events:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:0;z-index:2;opacity:0;transition:opacity .15s ease}',
  '.dshwv-menu-btn.dshwv-menu-btn-visible{opacity:1}',
  '.dshwv-menu-btn span{display:block;width:14px;height:2px;background:#fff;border-radius:1px}',
  '.dshwv-menu-btn:hover{background:#203170}',
  // 隐身模式：隐藏鲸鱼本体与菜单按钮，仅保留不可见热区用于唤回
  '.dshwv-root.dshwv-hidden .dshwv-body,.dshwv-root.dshwv-hidden .dshwv-menu-btn{display:none}',
  '.dshwv-hotspot{position:fixed;right:0;bottom:0;width:96px;height:96px;z-index:9998;cursor:pointer}',
  // 隐身模式唤回菜单：只保留「开关」一项，选回全部开启后恢复完整菜单
  '.dshwv-menu.dshwv-menu-mini{min-width:0}',
  '.dshwv-menu.dshwv-menu-mini .dshwv-menu-row,.dshwv-menu.dshwv-menu-mini .dshwv-menu-head{display:none}',
  '.dshwv-menu.dshwv-menu-mini .dshwv-always{display:flex}',
  // 隐身迷你菜单保留「开关行」整行（目标下拉 + 大小滑块）：整体=0 隐身后，拉回大小是唯一恢复手段
  '.dshwv-menu{position:fixed;min-width:196px;background:rgba(255,255,255,.92);border:1px solid rgba(32,49,112,.35);border-radius:10px;padding:8px 10px;opacity:0;transform:scale(.92) translateY(-4px);transform-origin:top right;transition:opacity .18s ease,transform .2s cubic-bezier(.34,1.56,.64,1);pointer-events:none;z-index:10000;box-shadow:0 6px 18px rgba(0,0,0,.18);color-scheme:light}',
  '.dshwv-menu.dshwv-menu-open{opacity:1;transform:scale(1) translateY(0);pointer-events:auto}',
  '.dshwv-menu-row{display:flex;align-items:center;gap:6px;margin:6px 0;color:#203170;font-size:12px;white-space:nowrap}',
  '.dshwv-range{width:70px;accent-color:#203170}',
  '.dshwv-number{width:40px;border:1px solid rgba(32,49,112,.4);border-radius:6px;padding:2px 4px;font-size:12px;color:#203170;background:#fff;box-sizing:border-box}',
  '.dshwv-number:disabled{opacity:.4;background:rgba(32,49,112,.06);cursor:not-allowed}',
  '.dshwv-sound{flex:1;border:1px solid rgba(32,49,112,.4);border-radius:6px;background:rgba(32,49,112,.08);color:#203170;font-size:12px;padding:3px 0;cursor:pointer}',
  '.dshwv-sound:hover{background:rgba(32,49,112,.16)}',
  '.dshwv-sound.dshwv-sound-sm{flex:0 0 auto;width:86px}',
  '.dshwv-check{width:16px;height:16px;accent-color:#203170;cursor:pointer;flex:0 0 auto}',
  // 分组标题：文字居中 + 两侧实线（—— 标题 ——）
  '.dshwv-menu-head{display:flex;align-items:center;gap:6px;margin:8px 0 3px;color:#203170;font-size:12px;font-weight:700;letter-spacing:.08em;white-space:nowrap}',
  '.dshwv-menu-head::before,.dshwv-menu-head::after{content:"";flex:1;height:1px;background:rgba(32,49,112,.4)}',
  '.dshwv-menu-head:first-child{margin-top:1px}',
  '.dshwv-volpct{color:#203170;font-size:12px}'
].join('\\n')

var styleEl = document.createElement('style')
styleEl.textContent = css
document.head.appendChild(styleEl)

var root = document.createElement('div')
root.className = 'dshwv-root'

var img = document.createElement('img')
img.className = 'dshwv-img'
img.src = IMG_URL
img.alt = 'DeepSeek 余额'
img.draggable = false

var menuBtn = document.createElement('button')
menuBtn.type = 'button'
menuBtn.className = 'dshwv-menu-btn'
menuBtn.title = '菜单'
menuBtn.innerHTML = '<span></span><span></span><span></span>'
menuBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleMenu() })

var menuBox = document.createElement('div')
menuBox.className = 'dshwv-menu'
function menuLabel(text, lead, title) {
  var s = document.createElement('span')
  s.textContent = text
  if (lead) s.className = 'dshwv-lead'
  if (title) s.title = title
  return s
}
function menuRow() {
  var r = document.createElement('div')
  r.className = 'dshwv-menu-row'
  return r
}
// 分组标题行（文字 + 横线）；always=true 时隐身迷你菜单里也显示
function menuHead(text, always) {
  var h = document.createElement('div')
  h.className = 'dshwv-menu-head' + (always ? ' dshwv-always' : '')
  h.textContent = text
  return h
}
// 菜单悬停说明（label 与对应控件共用一条，改文案只改这里）
var MENU_TIPS = {
  size: '调整所选部分的大小：0 = 隐藏该部分，调回大于 0 即恢复（8 ≈ 原始大小，20 最大）',
  sw: '选择要调整的部分：气泡 = 蓝色气泡框；字号 = 气泡里的文字；整体 = 挂件全部（0 = 右下角整体隐身，鼠标悬停右下角可唤出菜单，把数值调回大于 0 恢复）',
  sound: '按压/松手的音效包：小黄鸭 / 音效1（包内缺音频文件时静默）',
  vol: '音效音量',
  usage: '「今日已用」统计方式：小鲸鱼记账 = 余额差值自动记账（免令牌，推荐）；实时·令牌 = 调用平台用量接口按峰谷定价实时换算（需配置 DEEPSEEK_PLATFORM_TOKEN）',
  src: '用量视图统计来源（前端+校准合并）：未配置平台令牌时仅显示前端聚合数据，指示灯灰色；配置令牌（官网安装自动同步脚本 /dsh-whale/token-sync.user.js）后，官方 token 数追上本地即自动校准对齐官方，指示灯黄=有未校准的新增、绿=已校准',
  persist: '气泡常驻内容（可多选组合）：点击框体勾选 对话/余额/用量/峰谷 的任意组合；全不选 = 无常驻；全选 = 随机轮换全部；多选时点击气泡或轮播会在勾选的内容间切换（用量明细用大框展示）',
  lock: '峰时锁定：峰时勾选后「常驻」自动切到峰谷显示；峰时（工作日 9:00-12:00 / 14:00-18:00）隐藏 DeepSeek 会话的发送按钮并拦截键盘发送，气泡按轮播间隔交替显示峰谷样式与锁定中视图，谷时自动恢复。仅对 DeepSeek 模型生效，其他模型（如 GLM）不受影响',
  remind: '谷时提醒：谷时倒计时剩最后 30 分钟时触发——常驻自动切到峰谷显示并保持，气泡按轮播间隔交替显示峰谷样式与「即将结束」提醒视图；峰时开始或取消勾选自动结束',
  car: '轮播间隔秒数：常驻「对话/随机」内容的自动切换与峰时锁定/谷时提醒气泡轮播共用（样式与特殊视图交替出现，各占一半）；gif 动画会完整播完再切换；填 0 表示不轮播',
  turn: '每轮对话结束后自动弹出本轮消耗金额（按模型真实 usage 计价，无需令牌）',
  close: '消耗金额泡泡自动关闭的秒数；填 0 表示不自动关闭，需手动点击关闭',
  gap: '开启后挂件与页面滚动条保持距离，避免贴边被遮挡',
  gapw: '与滚动条/页面边缘保持的距离（像素），填 0 表示贴边',
}
var scaleInput = document.createElement('input')
scaleInput.type = 'range'
scaleInput.min = '0'
scaleInput.max = '20'
scaleInput.step = '1'
scaleInput.className = 'dshwv-range'
scaleInput.title = MENU_TIPS.size
scaleInput.value = '8'
var scaleNumber = document.createElement('input')
scaleNumber.type = 'number'
scaleNumber.min = '0'
scaleNumber.max = '20'
scaleNumber.step = '1'
scaleNumber.className = 'dshwv-number'
scaleNumber.value = '8'
scaleInput.addEventListener('pointerdown', function () { root.style.transition = 'none' })
scaleInput.addEventListener('input', function () { setPartScale(sizePart, scaleInput.value) })
scaleInput.addEventListener('change', function () { root.style.transition = '' })
scaleNumber.addEventListener('focus', function () { root.style.transition = 'none' })
scaleNumber.addEventListener('blur', function () { root.style.transition = '' })
scaleNumber.addEventListener('input', function () {
  setPartScale(sizePart, scaleNumber.value)
})
scaleNumber.addEventListener('change', function () {
  setPartScale(sizePart, scaleNumber.value)
  root.style.transition = ''
})
var soundSelect = document.createElement('select')
soundSelect.className = 'dshwv-sound dshwv-sound-sm'
soundSelect.title = MENU_TIPS.sound
function soundOpt(value, label) {
  var o = document.createElement('option')
  o.value = value
  o.textContent = label
  return o
}
soundSelect.appendChild(soundOpt('duck', '小黄鸭'))
soundSelect.appendChild(soundOpt('fx1', '音效1'))
soundSelect.addEventListener('change', function () { setSoundSet(soundSelect.value) })
var usageSelect = document.createElement('select')
usageSelect.className = 'dshwv-sound dshwv-sound-sm'
usageSelect.title = MENU_TIPS.usage
usageSelect.appendChild(soundOpt('ledger', '小鲸鱼记账 (推荐)'))
usageSelect.appendChild(soundOpt('token', '实时·令牌 (用法：去问dsh)'))
usageSelect.addEventListener('change', function () { setUsageMode(usageSelect.value) })
var sourceSelect = document.createElement('select')
sourceSelect.className = 'dshwv-sound dshwv-sound-sm'
sourceSelect.title = MENU_TIPS.src
sourceSelect.appendChild(soundOpt('hybrid', '前端+校准'))
sourceSelect.addEventListener('change', function () { setUsageSource(sourceSelect.value) })
var valleyRemindToggle = document.createElement('input')
valleyRemindToggle.type = 'checkbox'
valleyRemindToggle.className = 'dshwv-check'
valleyRemindToggle.checked = false
valleyRemindToggle.title = MENU_TIPS.remind
valleyRemindToggle.addEventListener('change', function () { setValleyRemind(valleyRemindToggle.checked) })
var peakLockToggle = document.createElement('input')
peakLockToggle.type = 'checkbox'
peakLockToggle.className = 'dshwv-check'
peakLockToggle.checked = false
peakLockToggle.title = MENU_TIPS.lock
peakLockToggle.addEventListener('change', function () { setPeakLock(peakLockToggle.checked) })
var switchSelect = document.createElement('select')
switchSelect.className = 'dshwv-sound dshwv-sound-sm'
switchSelect.title = MENU_TIPS.sw
switchSelect.appendChild(soundOpt('bubble', '气泡'))
switchSelect.appendChild(soundOpt('font', '字号'))
switchSelect.appendChild(soundOpt('whole', '整体'))
switchSelect.addEventListener('change', function () { sizePart = switchSelect.value; updateSizeInputs() })
var persistBox = document.createElement('button')
persistBox.type = 'button'
persistBox.className = 'dshwv-sound dshwv-sound-sm dshwv-persist-box'
persistBox.title = MENU_TIPS.persist
persistBox.textContent = '无'
var persistChecks = {}
var persistPop = document.createElement('div')
persistPop.className = 'dshwv-persist-pop'
;[['chat', '对话'], ['balance', '余额'], ['usage', '用量'], ['peak', '峰谷']].forEach(function (it) {
  var item = document.createElement('label')
  item.className = 'dshwv-persist-item'
  var cb = document.createElement('input')
  cb.type = 'checkbox'
  cb.className = 'dshwv-check'
  cb.addEventListener('change', function () { setPersistPart(it[0], cb.checked) })
  item.appendChild(document.createTextNode(it[1]))
  item.appendChild(cb)
  persistChecks[it[0]] = cb
  persistPop.appendChild(item)
})
persistBox.addEventListener('click', function (e) {
  e.stopPropagation()
  persistPop.classList.toggle('dshwv-open')
})
persistPop.addEventListener('click', function (e) { e.stopPropagation() })
document.addEventListener('click', function (e) {
  if (!persistPop.contains(e.target)) persistPop.classList.remove('dshwv-open')
})
var turnCostToggle = document.createElement('input')
turnCostToggle.type = 'checkbox'
turnCostToggle.className = 'dshwv-check'
turnCostToggle.checked = true
turnCostToggle.title = '每轮对话结束后自动显示本轮消耗金额'
turnCostToggle.addEventListener('change', function () { setTurnCostOn(turnCostToggle.checked) })
var turnCostCloseInput = document.createElement('input')
turnCostCloseInput.type = 'number'
turnCostCloseInput.min = '0'
turnCostCloseInput.step = '1'
turnCostCloseInput.className = 'dshwv-number'
turnCostCloseInput.value = '3'
turnCostCloseInput.disabled = false // 跟随「每轮消耗提示」开关
turnCostCloseInput.title = MENU_TIPS.close
turnCostCloseInput.addEventListener('input', function () { setTurnCostClose(turnCostCloseInput.value) })
turnCostCloseInput.addEventListener('change', function () { setTurnCostClose(turnCostCloseInput.value) })
var lockCarInput = document.createElement('input')
lockCarInput.type = 'number'
lockCarInput.min = '0'
lockCarInput.step = '1'
lockCarInput.className = 'dshwv-number'
lockCarInput.value = '3'
lockCarInput.title = MENU_TIPS.car
lockCarInput.addEventListener('input', function () { setLockCarousel(lockCarInput.value) })
lockCarInput.addEventListener('change', function () { setLockCarousel(lockCarInput.value) })
var scrollGapToggle = document.createElement('input')
scrollGapToggle.type = 'checkbox'
scrollGapToggle.className = 'dshwv-check'
scrollGapToggle.checked = false
scrollGapToggle.title = '开启后挂件右侧按设定像素避开滚动条；关闭则贴边（盖住滚动条）'
scrollGapToggle.addEventListener('change', function () { setScrollGapOn(scrollGapToggle.checked) })
var scrollGapInput = document.createElement('input')
scrollGapInput.type = 'number'
scrollGapInput.min = '0'
scrollGapInput.step = '1'
scrollGapInput.className = 'dshwv-number'
scrollGapInput.value = '17'
scrollGapInput.disabled = true // 默认避让关 → 宽度不可修改，勾选后启用
scrollGapInput.title = MENU_TIPS.gapw
scrollGapInput.addEventListener('input', function () { setScrollGapPx(scrollGapInput.value) })
scrollGapInput.addEventListener('change', function () { setScrollGapPx(scrollGapInput.value) })
var row1 = menuRow()
row1.appendChild(menuLabel('开关', true, MENU_TIPS.sw))
row1.appendChild(switchSelect)
// 大小控件标记 dshwv-size-ctl：隐身模式唤回的迷你菜单里随其余项一起隐藏
var sizeLabel = menuLabel('大小', null, MENU_TIPS.size)
sizeLabel.className = 'dshwv-size-ctl'
row1.appendChild(sizeLabel)
scaleInput.classList.add('dshwv-size-ctl')
scaleNumber.classList.add('dshwv-size-ctl')
row1.appendChild(scaleInput)
row1.appendChild(scaleNumber)
var row2 = menuRow()
row2.appendChild(menuLabel('音效', true, MENU_TIPS.sound))
row2.appendChild(soundSelect)
var volInput = document.createElement('input')
volInput.type = 'range'
volInput.min = '0'
volInput.max = '1'
volInput.step = '0.05'
volInput.className = 'dshwv-range'
volInput.title = MENU_TIPS.vol
volInput.value = '1'
var volPct = document.createElement('span')
volPct.className = 'dshwv-volpct'
volPct.textContent = '100%'
volInput.addEventListener('input', function () { setVol(volInput.value) })
row2.appendChild(menuLabel('音量', null, MENU_TIPS.vol))
row2.appendChild(volInput)
row2.appendChild(volPct)
// —— 第一组·基础设置：总开关 / 外观 / 声音 / 位置（row1 开关+大小、row2 音效+音量已在上）——
var row3 = menuRow()
row3.appendChild(menuLabel('避让滚动条', true, MENU_TIPS.gap))
row3.appendChild(scrollGapToggle)
row3.appendChild(menuLabel('宽度', null, MENU_TIPS.gapw))
row3.appendChild(scrollGapInput)
row3.appendChild(menuLabel('px'))
var resetSizeBtn = document.createElement('button')
resetSizeBtn.type = 'button'
resetSizeBtn.className = 'dshwv-reset'
resetSizeBtn.textContent = '恢复默认'
resetSizeBtn.title = '恢复全部设置为默认：大小 8 档（整体/气泡/字号）、小黄鸭音效 100%、常驻无、轮播 3 秒、自动关闭 3 秒、避让滚动条关'
resetSizeBtn.addEventListener('click', function (e) {
  e.stopPropagation()
  resetAllDefaults()
})
row3.appendChild(resetSizeBtn)
// —— 第二组·对话显示：气泡常驻内容与轮播 / 峰谷样式与锁定 ——
var row4 = menuRow()
row4.appendChild(menuLabel('常驻', true, MENU_TIPS.persist))
var persistWrap = document.createElement('span')
persistWrap.className = 'dshwv-persist-wrap'
persistWrap.appendChild(persistBox)
persistWrap.appendChild(persistPop)
row4.appendChild(persistWrap)
row4.appendChild(menuLabel('轮播', null, MENU_TIPS.car))
row4.appendChild(lockCarInput)
row4.appendChild(menuLabel('秒'))
var row5 = menuRow()
row5.appendChild(menuLabel('谷时提醒', true, MENU_TIPS.remind))
row5.appendChild(valleyRemindToggle)
row5.appendChild(menuLabel('峰时锁定', null, MENU_TIPS.lock))
row5.appendChild(peakLockToggle)
// —— 第三组·用量消耗：用量模式 / 统计来源 与 每轮统计 ——
var row6 = menuRow()
row6.appendChild(menuLabel('金额', true, MENU_TIPS.usage))
row6.appendChild(usageSelect)
row6.appendChild(menuLabel('用量', null, MENU_TIPS.src))
row6.appendChild(sourceSelect)
var row6b = menuRow()
row6b.appendChild(menuLabel('每轮消耗', true, MENU_TIPS.turn))
row6b.appendChild(turnCostToggle)
row6b.appendChild(menuLabel('自动关闭', null, MENU_TIPS.close))
row6b.appendChild(turnCostCloseInput)
row6b.appendChild(menuLabel('秒'))
row1.classList.add('dshwv-always') // 隐身迷你菜单保留「基础设置」标题 + 开关行
menuBox.appendChild(menuHead('基础设置', true))
menuBox.appendChild(row1)
menuBox.appendChild(row2)
menuBox.appendChild(row3)
menuBox.appendChild(menuHead('对话显示'))
menuBox.appendChild(row4)
menuBox.appendChild(row5)
menuBox.appendChild(menuHead('用量消耗'))
menuBox.appendChild(row6)
menuBox.appendChild(row6b)

var textBox = document.createElement('div')
textBox.className = 'dshwv-text'
var labelEl = document.createElement('div')
labelEl.className = 'dshwv-label'
labelEl.textContent = '余额'
var amountEl = document.createElement('div')
amountEl.className = 'dshwv-amount'
var hintEl = document.createElement('div')
hintEl.className = 'dshwv-hint'
// 第 4/5/6 行：用量视图等多行内容专用（3 行视图自动隐藏）
var line4El = document.createElement('div')
line4El.className = 'dshwv-stat'
var line5El = document.createElement('div')
line5El.className = 'dshwv-stat'
var line6El = document.createElement('div')
line6El.className = 'dshwv-stat'
textBox.appendChild(labelEl)
textBox.appendChild(amountEl)
textBox.appendChild(hintEl)
textBox.appendChild(line4El)
textBox.appendChild(line5El)
textBox.appendChild(line6El)

var bubbleBox = document.createElement('div')
bubbleBox.className = 'dshwv-bubble'
bubbleBox.innerHTML = '<svg viewBox="0 0 1026 700" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' +
  '<path class="dshwv-bshape" fill="#FFFFFF" stroke="#203170" stroke-width="18" stroke-linejoin="round" stroke-linecap="round" d="M 827 248 A 373 232 0 1 0 81 246 A 373 232 0 0 0 301 465 A 57 32 10 0 0 413 484 A 373 232 0 0 0 827 248 Z"/>' +
  '<ellipse class="dshwv-b1" cx="352" cy="561" rx="37.5" ry="26" fill="#FFFFFF" stroke="#203170" stroke-width="18"/>' +
  '<ellipse class="dshwv-b2" cx="442" cy="646" rx="24.5" ry="18" fill="#FFFFFF" stroke="#203170" stroke-width="18"/>' +
  '</svg>'
var gifEl = document.createElement('img')
gifEl.className = 'dshwv-gif'
gifEl.src = GIF_URL
gifEl.alt = ''
gifEl.draggable = false
bubbleBox.appendChild(gifEl)
var gifFailed = false
gifEl.onerror = function () { gifFailed = true }
// 解析 gif 一次完整播放的总时长（逐帧读 Graphic Control Extension 延时），
// 轮播切换时「完整播放」优先于设定的间隔
var gifDurationMs = 0
try {
  fetch(GIF_URL)
    .then(function (r) { return r.arrayBuffer() })
    .then(function (buf) {
      var d = new DataView(buf)
      if (buf.byteLength < 14 || d.getUint8(0) !== 0x47 || d.getUint8(1) !== 0x49) return
      var i = 13
      var gflags = d.getUint8(10)
      if (gflags & 0x80) i += 3 * (2 << (gflags & 7))
      var total = 0
      while (i < buf.byteLength) {
        var b = d.getUint8(i)
        if (b === 0x3B) break // trailer
        if (b === 0x21) { // 扩展块（0xF9 = 图形控制，含帧延时）
          if (d.getUint8(i + 1) === 0xF9) total += (d.getUint8(i + 4) | (d.getUint8(i + 5) << 8)) * 10
          i += 2
          while (i < buf.byteLength) { var sz = d.getUint8(i); i += 1 + sz; if (sz === 0) break }
        } else if (b === 0x2C) { // 图像描述符 + LZW 数据子块
          var f2 = d.getUint8(i + 9)
          i += 10
          if (f2 & 0x80) i += 3 * (2 << (f2 & 7))
          i += 1
          while (i < buf.byteLength) { var s2 = d.getUint8(i); i += 1 + s2; if (s2 === 0) break }
        } else break
      }
      gifDurationMs = total
    })
    .catch(function () {})
} catch (err) {}
bubbleBox.appendChild(textBox)
bubbleBox.addEventListener('click', function (e) {
  e.stopPropagation()
  if (!bubbleShown) return
  if (costBubbleActive) {
    // 消耗金额泡泡：点击关闭（确认）
    hideCostBubble()
    return
  }
  if (overrideActive()) {
    // 锁定/谷时提醒中：点击回特殊视图
    showLockBubble()
    return
  }
  var m = persistMode()
  if (m !== null) {
    // 常驻开启：点击 = 手动切换当前组的内容（对话换一条、随机换一组、余额/用量刷新数据、峰谷重绘）
    if (m === 'chat') showChatLines()
    else if (m === 'random') showRandomView()
    else if (m === 'balance') { restoreBubbleLines(); refresh(true) }
    else if (m === 'usage') { usageViewIdx++; applyBubbleLines(buildUsageLines()); fetchUsage(); scheduleChat() }
    else { advancePeakStyle(); applyBubbleLines(buildGroup1()); startPeakTick() }
    // 重启轮播计时：手动切换的内容同样享受完整停留时间（gif 完整播放优先）
    scheduleChat()
    return
  }
  // 无常驻：随机台词 ⇄ 关闭（原逻辑）
  if (bubbleRandomActive) {
    hideBubble()
  } else {
    // 首次点击：切到随机台词段，并重置自动关闭计时——
    // 保证第二段台词有完整停留时间（否则第 4 秒点击只看到 0.5 秒）
    bubbleRandomActive = true
    bubbleRandomLines = pickRandomLines()
    swapBubbleContent(function () { applyBubbleLines(bubbleRandomLines) })
    if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null }
    if (chatTimer) { clearTimeout(chatTimer); chatTimer = null }
    bubbleTimer = setTimeout(function () {
      bubbleTimer = null
      if (overrideActive()) showLockBubble()
      else if (persistMode() !== null) showBase()
      else hideBubble()
    }, BUBBLE_MS)
  }
})

var body = document.createElement('div')
body.className = 'dshwv-body'
body.appendChild(img)
body.appendChild(bubbleBox)
root.appendChild(body)
root.appendChild(menuBtn)
document.body.appendChild(root)
document.body.appendChild(menuBox)
// 隐身模式唤回入口：右下角不可见热区，悬停直接唤出菜单（此时菜单锚定屏幕右下角）
var hotspot = document.createElement('div')
hotspot.className = 'dshwv-hotspot'
hotspot.style.display = 'none'
hotspot.addEventListener('mouseenter', function () {
  if (widgetMode !== 'hidden' || menuOpen) return
  menuOpen = true
  positionMenu()
  menuBox.classList.add('dshwv-menu-open')
})
document.body.appendChild(hotspot)
// 校准指示灯：用量视图标题行右侧的小圆点（根节点镜像时随 transform 自动镜像）
var calibDotEl = document.createElement('div')
calibDotEl.className = 'dshwv-calib'
bubbleBox.appendChild(calibDotEl)

// Position model: the widget is ALWAYS expressed in left/top px (so edge snaps
// animate smoothly via the CSS transition on both sides — switching to
// right/auto cannot transition and flashes). The anchor info (h/v + offsets)
// lives in state and is used by settle() to recompute coordinates on window
// resize and size changes, keeping the widget glued to its anchored edge.
var state = {
  scale: 1,
  h: 'right',
  hOff: 0,
  v: 'bottom',
  vOff: 0,
  left: 0,
  top: 0,
  balance: null,
  currency: null,
  todayUsage: null,
  isPeak: false,
  status: 'loading',
  message: ''
}
var busy = false
var settleTimer = null
var animDelayTimer = null
var drag = null
var shown = null
var animId = null
var bubbleShown = false
var bubbleTimer = null
var bubbleRandomActive = false
var bubbleRandomLines = null
var BUBBLE_STYLE_CLASS = { A: 'dshwv-label', B: 'dshwv-amount', P: 'dshwv-period', C: 'dshwv-hint', T: 'dshwv-count', S: 'dshwv-stat', U: 'dshwv-uhero', R: 'dshwv-urow' }
function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function singleCenter(style, text, color, wrap) { return [null, { t: text, s: style, c: color || '', w: !!wrap }, null] }
// 峰谷显示视图：叫法可在 默认 ⇄ 梁文峰谷 ⇄ !?强强?! 三种形式间点击切换
var PEAK_STYLES = ['default', 'liangwen', 'qiangqiang']
var peakStyleIdx = 0
function advancePeakStyle() { peakStyleIdx = (peakStyleIdx + 1) % PEAK_STYLES.length }
function buildGroup1(styleIdx) {
  var peak = localIsPeak()
  var offText = '空闲时段'
  var peakText = '高峰时段'
  var st = PEAK_STYLES[(styleIdx !== undefined ? styleIdx : peakStyleIdx) % PEAK_STYLES.length]
  if (st === 'liangwen') {
    offText = '梁文谷'
    peakText = '梁文峰'
  } else if (st === 'qiangqiang') {
    offText = '!?谷谷?!'
    peakText = '!?峰峰?!'
  }
  // 第三行倒计时（大字）：谷时 = 距下次峰时（绿，剩 <1 小时转黄）；峰时 = 距谷（红，剩 ≤10 分钟转橙）
  var remain, color
  if (peak) {
    var pms = peakRemainMs()
    remain = pms === null ? '--:--:--' : fmtHms(pms)
    color = pms !== null && pms <= 10 * 60 * 1000 ? '#ff8c00' : '#e0433f'
  } else {
    var oms = offRemainMs()
    remain = oms === null ? '--:--:--' : fmtHms(oms)
    color = oms !== null && oms < 60 * 60 * 1000 ? '#e6b800' : '#2fa24c'
  }
  return [
    { t: '当前时间段为:', s: 'A', c: '' },
    { t: peak ? peakText : offText, s: 'P', c: peak ? '#e0433f' : '#2fa24c' },
    { t: remain, s: 'T', c: color },
  ]
}
// —— 用量视图：今日/本月 token 用量明细（5 行布局，多模型/今日本月按轮播间隔切换）——
var usageData = null
var usageUnits = [] // [{scope:'today'|'month', model}]，按消耗金额降序
var usageViewIdx = 0
// 当前气泡是否正在展示用量明细视图（指示灯跟随它，而非常驻模式——组合勾选下也应显示）
var usageViewOn = false
function fmtTok(n) {
  n = Number(n) || 0
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(Math.round(n))
}
function fmtCost(n) {
  n = Number(n) || 0
  if (n >= 0.01) return '¥' + n.toFixed(2)
  if (n > 0) return '¥' + n.toFixed(4)
  return '¥0'
}
function usageCostOf(b) {
  return b ? (Number(b.costCache) || 0) + (Number(b.costMiss) || 0) + (Number(b.costOut) || 0) : 0
}
function rebuildUsageUnits() {
  usageUnits = []
  if (!usageData) return
  // 前端来源只统计今日（本地月桶缺少历史、无法校准，本月块无意义）；
  // 校准来源有官方数据锚定，今日/本月都展示
  var scopes = usageSource === 'hybrid' && usageData.source === 'hybrid' ? ['today', 'month'] : ['today']
  for (var s = 0; s < scopes.length; s++) {
    var period = usageData[scopes[s]] || {}
    var models = Object.keys(period).sort(function (a, b) { return usageCostOf(period[b]) - usageCostOf(period[a]) })
    for (var i = 0; i < models.length; i++) usageUnits.push({ scope: scopes[s], model: models[i] })
  }
  if (usageViewIdx >= usageUnits.length) usageViewIdx = 0
}
var usageRetryTimer = null
function scheduleUsageFetch(ms) {
  // 拉取失败（如 dsh web 重启瞬间）自动重试，避免用量视图卡在「暂无统计」
  if (usageRetryTimer) return
  usageRetryTimer = setTimeout(function () {
    usageRetryTimer = null
    if (persistMode() === 'usage') fetchUsage()
  }, ms || 10000)
}
function fetchUsage() {
  try {
    fetch(TOKEN_STATS_URL, { cache: 'no-store' })
      .then(function (r) { return r.json() })
      .then(function (d) {
        if (!d || !d.ok) { scheduleUsageFetch(10000); return }
        usageData = d
        rebuildUsageUnits()
        updateCalibDot()
        if (bubbleShown && persistMode() === 'usage' && !bubbleRandomActive && !overrideActive()) {
          applyBubbleLines(buildUsageLines())
        }
      })
      .catch(function () { scheduleUsageFetch(10000) })
  } catch (err) {}
}
function setBubbleBig(on) {
  bubbleBox.classList.toggle('dshwv-bubble-big', on)
  if (!on) calibDotEl.style.display = 'none' // 指示灯只在用量视图显示
}
// 指示灯状态：仅 校准模式 + 用量视图 显示；接口返回 calib（'green'|'yellow'|'gray'）驱动
function updateCalibDot() {
  // 只要正在展示用量视图就显示指示灯（灰=未配置令牌，黄=待校准，绿=已校准）；
  // 旧逻辑限定校准常驻模式，组合勾选下会漏显
  var show = bubbleShown && fontScale > 0 && usageViewOn && usageData && usageData.calib
  calibDotEl.style.display = show ? 'block' : 'none'
  if (show) {
    var st = usageData.calib
    calibDotEl.className = 'dshwv-calib dshwv-calib-' + (st === 'yellow' || st === 'gray' ? st : 'green')
  }
}
function applyUsageView() {
  usageViewOn = true
  setBubbleBig(true)
  applyBubbleLines(buildUsageLines())
  updateCalibDot()
  fetchUsage()
}
function buildUsageLines() {
  var unit = usageUnits.length ? usageUnits[usageViewIdx % usageUnits.length] : null
  if (!unit) {
    // 无数据兜底：校准模式在 今日/本月 间切换；前端模式只有今日
    var scope = usageSource === 'hybrid' && usageViewIdx % 2 === 1 ? 'month' : 'today'
    return [
      { t: scope === 'today' ? '今日用量' : '本月用量', s: 'A', c: '' },
      { t: '暂无统计', s: 'C', c: '' },
    ]
  }
  var d = (usageData && usageData[unit.scope] && usageData[unit.scope][unit.model]) || {}
  var cache = Number(d.cache) || 0
  var miss = Number(d.miss) || 0
  var out = Number(d.out) || 0
  var hit = (cache + miss) > 0 ? Math.round(cache / (cache + miss) * 100) + '%' : '--'
  var costTotal = (Number(d.costCache) || 0) + (Number(d.costMiss) || 0) + (Number(d.costOut) || 0)
  // 官方真实金额包含峰时加价，本地价格表按谷价估算：差额=峰时多付，红色小字附在 hero 金额后。
  // 按「分」对齐再相减，避免 0.49/0.56 各自四舍五入后差额与显示金额对不上。
  var peakDeltaCents = Math.round((Number(d.officialCost) || 0) * 100) - Math.round(costTotal * 100)
  var costText = fmtCost(costTotal) + (costTotal >= 0.01 && peakDeltaCents >= 1 ? '<span class="dshwv-udelta">(+' + (peakDeltaCents / 100).toFixed(2) + ')</span>' : '')
  var totalTok = cache + miss + out
  var esc = String(unit.model || '未知模型').replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] })
  return [
    { t: unit.scope === 'today' ? '今日用量' : '本月用量', s: 'A', c: '' },
    { t: esc, s: 'C', c: '' },
    { t: '<span class="dshwv-utok">' + fmtTok(totalTok) + '<em>tok</em></span><span class="dshwv-ucost">' + costText + '</span>', s: 'U', h: 1, c: '' },
    { t: '<span class="dshwv-ulbl" style="color:#2fa24c">缓存</span><span class="dshwv-uval">' + fmtTok(cache) + '</span><span class="dshwv-upct">(' + hit + ')</span><span class="dshwv-ucost2">' + fmtCost(d.costCache) + '</span>', s: 'R', h: 1, c: '' },
    { t: '<span class="dshwv-ulbl" style="color:#e6a23c">未命中</span><span class="dshwv-uval">' + fmtTok(miss) + '</span><span class="dshwv-ucost2">' + fmtCost(d.costMiss) + '</span>', s: 'R', h: 1, c: '' },
    { t: '<span class="dshwv-ulbl" style="color:#4a7cf6">输出</span><span class="dshwv-uval">' + fmtTok(out) + '</span><span class="dshwv-ucost2">' + fmtCost(d.costOut) + '</span>', s: 'R', h: 1, c: '' },
  ]
}
// 余额视图静态快照（随机模式轮换用；常驻余额视图走 restoreBubbleLines+render 的活刷新）
function balanceSnapshotLines() {
  var usage = state.todayUsage !== null && state.todayUsage !== undefined ? fmt(state.todayUsage, state.currency) : '--'
  var bal = state.balance !== null ? (shown !== null ? fmt(shown, state.currency) : fmt(state.balance, state.currency)) : '…'
  return [
    { t: '余额', s: 'A', c: '' },
    { t: bal, s: 'B', c: '' },
    { t: '已用 ' + usage, s: 'C', c: '' },
  ]
}
var RANDOM_GROUPS = [
  { w: 7, lines: function () { return singleCenter('B', pickOne(['好模型... ↓', '好女孩...↓'])) } },
  { w: 7, lines: function () { return singleCenter('A', pickOne(['不知道用户有什么用，先赶走吧~', '我...我...我也要挣钱吗？', '我去吃饭啦，测完叫我', '压力一只蓝色大肥鱼？！', 'DeepSleep...', '坏了...用户彻底怒了！']), '', true) } },
  { w: 10, lines: function () { return { gif: true } } },
  { w: 3, lines: function () { return singleCenter('A', pickOne(['你目录里的dsh是什么...大烧货吗...?', '恭喜你实现token自由！token全跑了！', '真当我是便宜货啊...']), '', true) } },
  { w: 1, lines: function () { return singleCenter('B', '哦鲸鲸... ') } },
]
function pickRandomLines() {
  var total = 0
  for (var i = 0; i < RANDOM_GROUPS.length; i++) total += RANDOM_GROUPS[i].w
  var r = Math.random() * total
  for (var i = 0; i < RANDOM_GROUPS.length; i++) {
    r -= RANDOM_GROUPS[i].w
    if (r < 0) return RANDOM_GROUPS[i].lines()
  }
  return RANDOM_GROUPS[RANDOM_GROUPS.length - 1].lines()
}
function applyBubbleLines(lines) {
  if (lines && lines.gif) {
    // gif 台词组：只显示 gif，隐藏三行文字（display 必须显式覆盖 CSS 的 none）
    if (gifFailed) {
      // gif 加载失败/路由缺失：降级为文字台词，避免空白白色气泡
      lines = singleCenter('A', pickOne(['gif 加载失败了...', '今天没有动图给你看~', '呜呜 动图不见了...']), '', true)
    } else {
      if (gifFadeTimer) { clearTimeout(gifFadeTimer); gifFadeTimer = null }
      gifEl.style.display = 'block'
      gifEl.style.opacity = ''
      labelEl.style.display = 'none'
      amountEl.style.display = 'none'
      hintEl.style.display = 'none'
      // 用量明细占了 line4-6 三个槽位，GIF 提前 return 前必须一并清掉，
      // 否则「用量 → 动画」轮换时动画会叠在残留的文字行上
      line4El.style.display = 'none'
      line4El.textContent = ''
      line5El.style.display = 'none'
      line5El.textContent = ''
      line6El.style.display = 'none'
      line6El.textContent = ''
      return
    }
  }
  if (gifFadeTimer) { clearTimeout(gifFadeTimer); gifFadeTimer = null }
  gifEl.style.display = 'none'
  gifEl.style.opacity = ''
  var els = [labelEl, amountEl, hintEl, line4El, line5El, line6El]
  for (var i = 0; i < els.length; i++) {
    var el = els[i]
    var ln = lines && lines[i]
    if (ln) {
      el.style.display = ''
      el.className = (BUBBLE_STYLE_CLASS[ln.s] || 'dshwv-label') + (ln.w ? ' dshwv-wrap' : '')
      if (ln.h) { el.innerHTML = ln.t } else { el.textContent = ln.t }
      el.style.color = ln.c || ''
    } else {
      el.style.display = 'none'
      el.textContent = ''
      el.style.color = ''
    }
  }
}
var bubbleSwapTimer = null
var hintFadeTimer = null
var gifFadeTimer = null
var lastHintText = null
function setHint(text) {
  // 首次/恢复（lastHintText===null）时直接写文本，不做淡出淡入——否则
  // 气泡打开或按压重开时会先淡出再淡入，造成「消失一下又出现」。
  // 只有气泡打开期间的内容变化（加载中→今日已用）才走动画。
  if (text === lastHintText) return
  var first = lastHintText === null
  lastHintText = text
  if (first || !bubbleShown) {
    hintEl.textContent = text
    return
  }
  hintEl.style.transition = 'opacity .18s ease'
  hintEl.style.opacity = '0'
  hintFadeTimer = setTimeout(function () {
    hintFadeTimer = null
    hintEl.textContent = text
    hintEl.style.opacity = '1'
    setTimeout(function () {
      hintEl.style.transition = ''
      hintEl.style.opacity = ''
    }, 220)
  }, 190)
}
function swapBubbleContent(applyFn) {
  if (bubbleSwapTimer) { clearTimeout(bubbleSwapTimer); bubbleSwapTimer = null }
  textBox.style.transition = 'opacity .18s ease'
  textBox.style.opacity = '0'
  bubbleSwapTimer = setTimeout(function () {
    bubbleSwapTimer = null
    applyFn()
    textBox.style.opacity = '1'
    setTimeout(function () {
      textBox.style.transition = ''
      textBox.style.opacity = ''
    }, 220)
  }, 190)
}
function restoreBubbleLines() {
  if (bubbleSwapTimer) { clearTimeout(bubbleSwapTimer); bubbleSwapTimer = null }
  if (hintFadeTimer) { clearTimeout(hintFadeTimer); hintFadeTimer = null }
  if (gifFadeTimer) { clearTimeout(gifFadeTimer); gifFadeTimer = null }
  lastHintText = null
  textBox.style.transition = ''
  textBox.style.opacity = ''
  gifEl.style.display = 'none'
  gifEl.style.opacity = ''
  labelEl.style.display = ''
  labelEl.className = 'dshwv-label'
  labelEl.textContent = '余额'
  labelEl.style.color = ''
  amountEl.style.display = ''
  amountEl.className = 'dshwv-amount'
  amountEl.style.color = ''
  hintEl.style.display = ''
  hintEl.className = 'dshwv-hint'
  hintEl.style.color = ''
  line4El.style.display = 'none'
  line4El.textContent = ''
  line5El.style.display = 'none'
  line5El.textContent = ''
  line6El.style.display = 'none'
  line6El.textContent = ''
  render()
}
function showBubble() {
  if (!bubbleOn) return
  // 消耗金额泡泡显示期间，余额变动不再弹出普通泡泡
  if (costBubbleActive) return
  // 锁定生效期间弹泡一律显示锁定提示；常驻模式走基础视图路由
  if (overrideActive()) { showLockBubble(); return }
  if (persistMode() !== null) { showBase(); return }
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null }
  if (gifFadeTimer) { clearTimeout(gifFadeTimer); gifFadeTimer = null }
  bubbleShown = true
  bubbleRandomActive = false
  restoreBubbleLines()
  bubbleBox.classList.add('dshwv-bubble-open')
  // 默认展示当前内容；点击气泡切到随机台词段；总时长 5 秒自动关闭
  bubbleTimer = setTimeout(hideBubble, BUBBLE_MS)
}
function hideBubble() {
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null }
  if (chatTimer) { clearTimeout(chatTimer); chatTimer = null }
  stopPeakTick()
  setBubbleBig(false)
  stopLockCarousel()
  if (bubbleSwapTimer) { clearTimeout(bubbleSwapTimer); bubbleSwapTimer = null }
  if (hintFadeTimer) { clearTimeout(hintFadeTimer); hintFadeTimer = null }
  textBox.style.transition = ''
  textBox.style.opacity = ''
  hintEl.style.transition = ''
  hintEl.style.opacity = ''
  bubbleRandomActive = false
  bubbleRandomLines = null
  bubbleShown = false
  // 只销毁 gif 显示；三行文字保持现状让气泡自然淡出——不能在关闭瞬间
  // 恢复成余额内容（否则随机台词界面会闪现余额）。文字恢复交给下次
  // showBubble() 的 restoreBubbleLines()（那时气泡隐藏，恢复过程不可见）。
  bubbleBox.classList.remove('dshwv-bubble-open')
  // gif 靠 CSS opacity 过渡淡出；display:none 会跳过过渡，须等淡出完成再隐藏
  gifFadeTimer = setTimeout(function () {
    gifFadeTimer = null
    gifEl.style.display = 'none'
  }, 240)
}

// —— 每轮对话消耗金额泡泡 ——
var costBubbleTimer = null
function showCostBubble(amount) {
  if (!bubbleOn || !turnCostOn) return
  if (costBubbleTimer) { clearTimeout(costBubbleTimer); costBubbleTimer = null }
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null }
  if (chatTimer) { clearTimeout(chatTimer); chatTimer = null }
  stopLockCarousel()
  if (gifFadeTimer) { clearTimeout(gifFadeTimer); gifFadeTimer = null }
  // 取消进行中的余额数字滚动与延迟计时器，避免竞态覆盖成本金额
  if (animId) { cancelAnimationFrame(animId); animId = null }
  if (animDelayTimer) { clearTimeout(animDelayTimer); animDelayTimer = null }
  if (settleTimer) { clearTimeout(settleTimer); settleTimer = null }
  costBubbleActive = true
  bubbleRandomActive = false
  bubbleShown = true
  lastHintText = null
  // 样式：第一行 A（标签），第二行 B（红色金额），居中两行
  gifEl.style.display = 'none'
  gifEl.style.opacity = ''
  labelEl.style.display = ''
  labelEl.className = 'dshwv-label'
  labelEl.textContent = '上一轮对话消耗:'
  labelEl.style.color = ''
  amountEl.style.display = ''
  amountEl.className = 'dshwv-amount'
  amountEl.textContent = '¥ ' + (isFinite(amount) ? Number(amount).toFixed(2) : '--')
  amountEl.style.color = '#e0433f'
  hintEl.style.display = 'none'
  hintEl.textContent = ''
  hintEl.style.color = ''
  line4El.style.display = 'none'
  line4El.textContent = ''
  line5El.style.display = 'none'
  line5El.textContent = ''
  line6El.style.display = 'none'
  line6El.textContent = ''
  textBox.style.transition = ''
  textBox.style.opacity = ''
  bubbleBox.classList.add('dshwv-bubble-open')
  if (turnCostCloseMs > 0) {
    costBubbleTimer = setTimeout(hideCostBubble, turnCostCloseMs)
  }
}
function hideCostBubble() {
  if (costBubbleTimer) { clearTimeout(costBubbleTimer); costBubbleTimer = null }
  costBubbleActive = false
  // 常驻/锁定模式：消耗泡泡结束后回到常驻视图（showBubble 内部按状态路由）
  if (bubbleOn && (persistMode() !== null || overrideActive())) showBubble()
  else hideBubble()
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v) }
function viewport() {
  return {
    w: window.innerWidth || document.documentElement.clientWidth || 1280,
    h: window.innerHeight || document.documentElement.clientHeight || 800
  }
}
function rightGap() {
  // 开关关闭：贴边（不避让滚动条）
  if (!scrollGapOn) return 0
  // 开启：用用户填写的像素；填 0 也贴边
  return scrollGapPx > 0 ? scrollGapPx : 0
}
function fmt(balance, currency) {
  var num = Number(balance)
  var fixed = isFinite(num) ? num.toFixed(2) : '--'
  return currency === 'CNY' ? '¥ ' + fixed : fixed + ' ' + currency
}
function animateAmount(from, to, currency, duration) {
  // 消耗金额泡泡显示期间，余额数字滚动不触碰金额行
  if (costBubbleActive) return
  if (animId) cancelAnimationFrame(animId)
  if (from === null || !isFinite(from)) from = to
  if (from === to) {
    shown = to
    amountEl.textContent = fmt(to, currency)
    return
  }
  var startTime = null
  function step(ts) {
    // 帧级保护：成本泡泡出现后立即停止滚动，避免后续帧把余额写进金额行
    if (costBubbleActive) {
      animId = null
      return
    }
    if (startTime === null) startTime = ts
    var t = Math.min(1, (ts - startTime) / duration)
    var eased = 1 - Math.pow(1 - t, 3)
    var val = from + (to - from) * eased
    amountEl.textContent = fmt(val, currency)
    if (t < 1) {
      animId = requestAnimationFrame(step)
    } else {
      animId = null
      shown = to
      amountEl.textContent = fmt(to, currency)
    }
  }
  animId = requestAnimationFrame(step)
}
function render() {
  // 消耗金额泡泡显示期间，余额渲染不覆盖其内容（金额行/标题行/提示行）
  if (costBubbleActive) return
  // 锁定提示/时段常驻视图：余额刷新时重画对应视图内容（随 state 更新今日已用）
  if (bubbleShown && !bubbleRandomActive && overrideActive()) { applyLockView(); return }
  if (bubbleShown && !bubbleRandomActive && persistMode() === 'peak') { applyBubbleLines(buildGroup1()); return }
  if (bubbleShown && !bubbleRandomActive && persistMode() === 'usage') { applyBubbleLines(buildUsageLines()); return }
  var amount, hint
  if (state.status === 'error') {
    amount = shown !== null ? fmt(shown, state.currency) : '--'
    hint = state.message ? state.message.slice(0, 14) : '获取失败 · 点击重试'
  } else if (state.balance === null) {
    amount = shown !== null ? fmt(shown, state.currency) : '…'
    hint = '加载中…'
  } else {
    amount = shown !== null ? fmt(shown, state.currency) : fmt(state.balance, state.currency)
    hint = '已用 ' + (state.todayUsage !== null && state.todayUsage !== undefined ? fmt(state.todayUsage, state.currency) : '--')
  }
  amountEl.textContent = amount
  if (bubbleRandomActive && bubbleRandomLines) {
    applyBubbleLines(bubbleRandomLines)
  } else {
    setHint(hint)
  }
}
function express() {
  root.style.right = 'auto'
  root.style.bottom = 'auto'
  root.style.left = state.left + 'px'
  root.style.top = state.top + 'px'
  root.classList.toggle('dshwv-left', state.h === 'left')
}
function settle() {
  var vp = viewport()
  var w = root.offsetWidth || root.getBoundingClientRect().width || 0
  var h = root.offsetHeight || root.getBoundingClientRect().height || 0
  if (drag && drag.active) {
    // mid-drag resize: keep the pointer-follow position, just clamp into view
    state.left = clamp(state.left, 0, Math.max(0, vp.w - w - rightGap()))
    state.top = clamp(state.top, 0, Math.max(0, vp.h - h))
    express()
    return
  }
  if (state.h === 'right') {
    state.left = Math.max(0, vp.w - w - state.hOff - rightGap())
  } else if (state.h === 'left') {
    state.left = state.hOff
  } else {
    state.left = clamp(state.left, 0, Math.max(0, vp.w - w - rightGap()))
  }  if (state.v === 'bottom') {
    state.top = Math.max(0, vp.h - h - state.vOff)
  } else if (state.v === 'top') {
    state.top = state.vOff
  } else {
    state.top = clamp(state.top, 0, Math.max(0, vp.h - h))
  }
  express()
}
function refresh(manual) {
  if (busy) return
  busy = true
  if (animDelayTimer) { clearTimeout(animDelayTimer); animDelayTimer = null }
  if (manual || state.balance === null) { state.status = 'loading'; render() }
  var ctrl = null
  var timer = null
  try {
    ctrl = new AbortController()
    timer = setTimeout(function () { try { ctrl.abort() } catch (err) {} }, FETCH_TIMEOUT_MS)
  } catch (err) {}
  fetch(BALANCE_URL, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
    .then(function (r) { return r.json() })
    .then(function (data) {
      if (data && data.ok) {
        var nb = Number(data.totalBalance)
        var nc = String(data.currency || 'CNY')
        var changed = state.balance !== null && (nb !== state.balance || nc !== state.currency)
        var currencyChanged = state.currency !== null && nc !== state.currency
        state.balance = nb
        state.currency = nc
        state.message = ''
        state.todayUsage = data.todayUsage !== undefined ? data.todayUsage : null
        state.isPeak = !!data.isPeak
        if (changed && !currencyChanged) {
          if (!manual) {
            showBubble()
            state.status = 'changing'
            // balance-change bubble: wait 0.3s after it floats out, then roll the number
            if (animDelayTimer) clearTimeout(animDelayTimer)
            animDelayTimer = setTimeout(function () {
              animDelayTimer = null
              animateAmount(shown, nb, nc, ANIM_MS)
            }, 300)
            if (settleTimer) clearTimeout(settleTimer)
            settleTimer = setTimeout(function () {
              settleTimer = null
              if (state.status === 'changing') { state.status = 'ok'; render() }
            }, CHANGE_MS + 300)
          } else {
            animateAmount(shown, nb, nc, ANIM_MS)
            state.status = 'ok'
            render()
          }
        } else {
          if (animId === null) shown = nb
          state.status = 'ok'
          render()
        }
      } else {
        state.status = 'error'
        state.message = (data && data.error) ? String(data.error) : '获取失败'
        render()
      }
    })
    .catch(function () {
      state.status = 'error'
      state.message = '获取失败'
      render()
    })
    .finally(function () {
      busy = false
      if (timer) clearTimeout(timer)
    })
}
// —— 梁文峰时段锁定 ——
// 勾选后自动把「常驻」切到峰谷显示；处于高峰时段（工作日 9-12 / 14-18，北京时间；周末全天谷价不算）
// 且当前模型是 DeepSeek 时：隐藏发送按钮 + 拦截键盘发送，气泡轮播锁定视图。
// 锁定气泡 4 视图轮播：3 种峰谷叫法样式（默认/梁文峰谷/峰峰，含倒计时）+ 锁定特殊视图
// 特殊视图文案：谷时提醒触发 → 梁文谷时段/即将结束（黄）；否则峰时锁定 → 锁定中（红）
function lockSpecialLines() {
  if (remindActive) {
    return [
      { t: '梁文谷时段', s: 'A', c: '' },
      { t: '即将结束', s: 'P', c: '#e6b800' },
      { t: '天才程序员的陨落', s: 'C', c: '' },
    ]
  }
  return [
    { t: '梁文峰时段', s: 'A', c: '' },
    { t: '锁定中', s: 'P', c: '#e0433f' },
    { t: '亿万鲸子仍需忍耐', s: 'C', c: '' },
  ]
}
// 锁定视图序号：0 = 特殊锁定视图；1/2/3 = PEAK_STYLES 对应的峰谷样式（含倒计时）
var lockCarTimer = null
var lockTickTimer = null
var lockViewIdx = 0
function stopLockCarousel() {
  if (lockCarTimer) { clearTimeout(lockCarTimer); lockCarTimer = null }
  if (lockTickTimer) { clearInterval(lockTickTimer); lockTickTimer = null }
}
function applyLockView() {
  applyBubbleLines(lockViewIdx === 0 ? lockSpecialLines() : buildGroup1(lockViewIdx - 1))
}
// 样式视图（1-3）里的倒计时逐秒刷新；特殊视图为静态文案
function startLockTick() {
  if (lockTickTimer) { clearInterval(lockTickTimer); lockTickTimer = null }
  if (lockViewIdx === 0 || !overrideActive() || !bubbleShown) return
  lockTickTimer = setInterval(function () {
    if (lockViewIdx === 0 || !overrideActive() || !bubbleShown || costBubbleActive) {
      if (lockTickTimer) { clearInterval(lockTickTimer); lockTickTimer = null }
      return
    }
    applyBubbleLines(buildGroup1(lockViewIdx - 1))
  }, 1000)
}
function scheduleLockCarousel() {
  if (lockCarTimer) { clearTimeout(lockCarTimer); lockCarTimer = null }
  if (!overrideActive() || !bubbleShown || lockCarouselMs <= 0 || costBubbleActive) return
  lockCarTimer = setTimeout(function () {
    lockCarTimer = null
    if (!overrideActive() || !bubbleShown || costBubbleActive) return
    // 权重：三个峰谷样式合计 0.5（随机三选一），锁定中 0.5 —— 样式视图后必定切锁定中
    lockViewIdx = lockViewIdx === 0 ? 1 + Math.floor(Math.random() * 3) : 0
    applyLockView()
    startLockTick()
    scheduleLockCarousel()
  }, lockCarouselMs)
}
function showLockBubble() {
  if (!bubbleOn) return
  if (costBubbleActive) return
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null }
  if (gifFadeTimer) { clearTimeout(gifFadeTimer); gifFadeTimer = null }
  bubbleShown = true
  bubbleRandomActive = false
  bubbleRandomLines = null
  lastHintText = null
  setBubbleBig(false)
  textBox.style.transition = ''
  textBox.style.opacity = ''
  lockViewIdx = 0 // 每次弹出从锁定特殊视图开始
  applyLockView()
  bubbleBox.classList.add('dshwv-bubble-open')
  scheduleLockCarousel()
  startLockTick()
}
// ══════════【测试脚本 · 正式版保留】峰谷假时间线 ══════════
// 用途：免等待真实时段切换，完整观察 谷时倒计时/谷时提醒 → 峰时倒计时/峰时锁定 → 还原 的交替流程。
// 用法：FAKE_TRANSITION_TEST 改 true 后重启 dsh web（或刷新页面），时间线从页面加载起算——
//       谷 FAKE_VALLEY_MS 倒计时 → 峰 FAKE_PEAK_MS 倒计时 → 自动还原真实时间；每次刷新重放一遍。
// 发布前：改回 false 即可，本段代码保留、不影响任何正式功能。
var FAKE_TRANSITION_TEST = false
var FAKE_VALLEY_MS = 30000 // 谷时阶段时长
var FAKE_PEAK_MS = 30000   // 峰时阶段时长
var fakeTransStart = FAKE_TRANSITION_TEST ? Date.now() : 0
// 前端独立判定峰时（与宿主 isPeakTime 同规则）：工作日 9-12 / 14-18（北京时间）
function localIsPeak() {
  if (fakeTransStart) {
    var te = Date.now() - fakeTransStart
    return te >= FAKE_VALLEY_MS && te < FAKE_VALLEY_MS + FAKE_PEAK_MS
  }
  var bj = new Date(Date.now() + 8 * 3600 * 1000)
  var dow = bj.getUTCDay()
  if (dow === 0 || dow === 6) return false
  var hour = bj.getUTCHours()
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}
function fmtHms(ms) {
  var h = Math.floor(ms / 3600000)
  var m = Math.floor((ms % 3600000) / 60000)
  var s = Math.floor((ms % 60000) / 1000)
  return (h < 10 ? '0' + h : '' + h) + ':' + (m < 10 ? '0' + m : '' + m) + ':' + (s < 10 ? '0' + s : '' + s)
}
// 距当前高峰时段结束（12:00 / 18:00，北京时间）的剩余毫秒；非峰时返回 null
function peakRemainMs() {
  if (fakeTransStart) {
    var te = Date.now() - fakeTransStart
    if (te >= FAKE_VALLEY_MS && te < FAKE_VALLEY_MS + FAKE_PEAK_MS) return FAKE_VALLEY_MS + FAKE_PEAK_MS - te
    return null
  }
  var bj = new Date(Date.now() + 8 * 3600 * 1000)
  var dow = bj.getUTCDay()
  if (dow === 0 || dow === 6) return null
  var hour = bj.getUTCHours()
  var endHour = hour >= 9 && hour < 12 ? 12 : (hour >= 14 && hour < 18 ? 18 : null)
  if (endHour === null) return null
  return Math.max(0, Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate(), endHour, 0, 0) - bj.getTime())
}
function peakRemainText() {
  var ms = peakRemainMs()
  return ms === null ? null : fmtHms(ms)
}
// 距下一个高峰时段开始（工作日 9:00 / 14:00，跨天自动跳过周末）的剩余毫秒；峰时返回 null
function offRemainMs() {
  if (fakeTransStart) {
    var te = Date.now() - fakeTransStart
    if (te < FAKE_VALLEY_MS) return FAKE_VALLEY_MS - te
    if (te < FAKE_VALLEY_MS + FAKE_PEAK_MS) return null // 假峰时
    // 假时间线走完，回落真实谷时倒计时
  }
  var bj = new Date(Date.now() + 8 * 3600 * 1000)
  var dow = bj.getUTCDay()
  var hour = bj.getUTCHours()
  if (dow !== 0 && dow !== 6 && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18))) return null
  var addDays = 0
  var targetHour = 9
  if (dow === 6) addDays = 2 // 周六 → 周一 9:00
  else if (dow === 0) addDays = 1 // 周日 → 周一 9:00
  else if (hour < 9) targetHour = 9 // 当天 9:00
  else if (hour < 14) targetHour = 14 // 午间谷 → 当天 14:00
  else addDays = dow === 5 ? 3 : 1 // 18 点后 → 明天 9:00（周五跳到周一）
  return Math.max(0, Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate() + addDays, targetHour, 0, 0) - bj.getTime())
}
// 当前模型是否 DeepSeek：读模型选择器触发按钮的 title/aria-label（如
// "DeepSeek-V4.1-Flash · High"）；选择器不在 DOM 时按非 DeepSeek 处理（不锁）
function composerIsDeepSeek() {
  var btns = document.querySelectorAll('button[aria-haspopup="menu"][title]')
  for (var i = 0; i < btns.length; i++) {
    var t = btns[i].getAttribute('title') || ''
    if (/[·\/]/.test(t) && /deepseek/i.test(t)) return true
  }
  return false
}
var SEND_LABELS = ['发送消息', '排队发送', '插话发送', 'Send message', 'Queue message', 'Steer message']
function isSendButton(el) {
  if (!el || el.tagName !== 'BUTTON' || el.type !== 'button') return false
  var a = el.getAttribute('aria-label') || ''
  for (var i = 0; i < SEND_LABELS.length; i++) {
    if (a === SEND_LABELS[i]) return true
  }
  return false
}
// 隐藏样式走内联 + data 标记：React 重渲染会重建节点，靠 MutationObserver 压住。
// 未锁定且无残留标记时早退，避免高频 DOM 变化下全量扫描
var lockedButtons = []
function applyLockToComposer() {
  if (!lockActive) {
    for (var k = 0; k < lockedButtons.length; k++) {
      var o = lockedButtons[k]
      if (o && o.hasAttribute && o.hasAttribute('data-dshw-lock')) {
        o.removeAttribute('data-dshw-lock')
        o.style.display = ''
      }
    }
    lockedButtons = []
    return
  }
  var btns = document.querySelectorAll('button[type="button"]')
  var next = []
  for (var i = 0; i < btns.length; i++) {
    var b = btns[i]
    if (isSendButton(b)) {
      b.setAttribute('data-dshw-lock', '1')
      b.style.display = 'none'
      next.push(b)
    }
  }
  lockedButtons = next
}
// 拦截聊天输入框内的 Enter 发送（Lexical 编辑器在 keydown 捕获阶段处理命令）
function onLockKeydown(e) {
  if (!lockActive) return
  if (e.key !== 'Enter') return
  var el = e.target
  if (!el || !el.closest || !el.closest('[data-composer-input]')) return
  e.preventDefault()
  e.stopPropagation()
}
// 峰时/模型变化检测循环：判定锁定状态并应用/解除
function updateLockState() {
  var shouldLock = peakLockOn && localIsPeak() && composerIsDeepSeek()
  if (shouldLock === lockActive) { applyLockToComposer(); return }
  lockActive = shouldLock
  applyLockToComposer()
  if (lockActive) {
    // 进入锁定：弹锁定提示（bubbleOn 关时不弹，按钮照藏）
    if (bubbleOn) showLockBubble()
  } else {
    // 解除锁定：常驻模式恢复显示，否则收起
    if (bubbleShown && persistMode() !== null) showBase()
    else if (bubbleShown) hideBubble()
  }
}
var lockObserver = null
function startLockWatch() {
  try {
    lockObserver = new MutationObserver(function () { if (lockActive) applyLockToComposer() })
    lockObserver.observe(document.body, { childList: true, subtree: true })
  } catch (err) {}
  document.addEventListener('keydown', onLockKeydown, true)
  setInterval(function () { updateLockState(); updateRemindState() }, 5000)
  updateLockState()
  updateRemindState()
}

var soundOn = true
var soundVol = 0.9
var soundSet = 'duck'
var usageMode = 'ledger'
// 用量视图统计来源：前端/校准已合并为单一 'hybrid'（无令牌自动回退纯前端数据，有令牌自动校准）
var usageSource = 'hybrid'
var peakMode = 'default'
// 总开关由三路缩放派生（整体 0=hidden，气泡 0=nobubble，其余=all）；sizePart 是大小控件当前选中的目标
var widgetMode = 'all'
var sizePart = 'whole'
var bubbleScale = 1
var fontScale = 1
// 下拉框初始选中项必须与 sizePart 一致（默认整体）——否则显示「气泡」实际却调整体
switchSelect.value = sizePart
var bubbleOn = true
var turnCostOn = true
var turnCostCloseMs = 5000
var lockCarouselMs = 5000
var costBubbleActive = false
var scrollGapOn = false
var scrollGapPx = 17
var peakLockOn = false
var lockActive = false
// 谷时提醒：勾选后谷时倒计时剩最后 30 分钟触发（3+1 提醒轮播 + 常驻自动切峰谷）
var valleyRemindOn = false
var remindActive = false
// 气泡接管显示中（峰时锁定 或 谷时提醒触发）
function overrideActive() { return lockActive || remindActive }
// 常驻模式（单选）：'peak' | 'balance' | 'usage' | 'chat' | 'random' | null
// 兼容旧字段迁移：优先读 persistMode，其次读旧布尔字段
// 常驻内容多选：'chat' | 'balance' | 'usage' | 'peak' 的任意组合；空 = 无常驻，全选 = 随机（等价于旧随机：在全部四类里轮换）
var persistModes = []
function persistMode() {
  // 派生旧语义供既有逻辑使用：无 = null；单选 = 该模式；多选 = 'random'（只在勾选范围内轮换）
  var n = persistModes.length
  if (n === 0) return null
  if (n === 1) return persistModes[0]
  return 'random'
}
function persistLabel() {
  var names = { chat: '对话', balance: '余额', usage: '用量', peak: '峰谷' }
  var n = persistModes.length
  if (n === 0) return '无'
  if (n === 4) return '随机'
  return persistModes.map(function (id) { return names[id] }).join('+')
}
function persistOrder(list) {
  return ['chat', 'balance', 'usage', 'peak'].filter(function (id) { return list.indexOf(id) >= 0 })
}
function syncPersistChecks() {
  for (var id in persistChecks) persistChecks[id].checked = persistModes.indexOf(id) >= 0
}
// 把气泡切回当前常驻模式的基础视图（锁定提示优先）；未开常驻且气泡未开时走普通弹出
function showBase() {
  stopPeakTick()
  usageViewOn = false
  setBubbleBig(false)
  if (costBubbleActive) return
  if (!bubbleOn) return
  if (overrideActive()) { showLockBubble(); return }
  var m = persistMode()
  if (m === null) { if (!bubbleShown) showBubble(); return }
  if (chatTimer) { clearTimeout(chatTimer); chatTimer = null }
  if (!bubbleShown) {
    bubbleShown = true
    lastHintText = null
    textBox.style.transition = ''
    textBox.style.opacity = ''
    bubbleBox.classList.add('dshwv-bubble-open')
  }
  if (m === 'peak') {
    bubbleRandomActive = false
    bubbleRandomLines = null
    applyBubbleLines(buildGroup1())
    startPeakTick() // 倒计时逐秒刷新
  } else if (m === 'balance') {
    bubbleRandomActive = false
    bubbleRandomLines = null
    restoreBubbleLines()
  } else if (m === 'usage') {
    bubbleRandomActive = false
    bubbleRandomLines = null
    applyUsageView()
  } else if (m === 'random') {
    // 随机：在 对话/用量/峰谷显示/余额 四组内容中轮换
    showRandomView()
    scheduleChat()
  } else {
    // chat：随机台词轮播
    showChatLines()
    scheduleChat()
  }
}
// chat 模式：换一组随机台词（气泡保持打开）
function showChatLines() {
  bubbleRandomActive = true
  bubbleRandomLines = pickRandomLines()
  applyBubbleLines(bubbleRandomLines)
}
// 随机模式：在勾选的常驻内容中随机挑一组展示（用量明细需要放大气泡，其余用小气泡）
function showRandomView() {
  bubbleRandomActive = true
  var pool = persistModes.length ? persistModes : ['chat', 'balance', 'usage', 'peak']
  var pick = pool[Math.floor(Math.random() * pool.length)]
  var lines
  usageViewOn = pick === 'usage'
  if (pick === 'usage') { lines = buildUsageLines(); setBubbleBig(true) }
  else { lines = pick === 'chat' ? pickRandomLines() : pick === 'peak' ? buildGroup1() : balanceSnapshotLines(); setBubbleBig(false) }
  bubbleRandomLines = lines
  applyBubbleLines(lines)
  updateCalibDot()
}
// chat/random/usage 模式轮播计时：间隔 = 菜单「轮播」秒数（0 = 不轮播，内容停在当前）；
// 当前内容是 gif 时完整播放优先——动画时长超过间隔则等播完再切
var chatTimer = null
function scheduleChat() {
  if (chatTimer) { clearTimeout(chatTimer); chatTimer = null }
  var m = persistMode()
  if ((m !== 'chat' && m !== 'random' && m !== 'usage') || !bubbleShown || !bubbleOn) return
  if (lockCarouselMs <= 0) return
  var iv = lockCarouselMs
  if (bubbleRandomLines && bubbleRandomLines.gif && gifDurationMs > iv) iv = gifDurationMs + 200
  chatTimer = setTimeout(function () {
    chatTimer = null
    var m2 = persistMode()
    if ((m2 !== 'chat' && m2 !== 'random' && m2 !== 'usage') || !bubbleShown || !bubbleOn) return
    if (costBubbleActive || overrideActive()) return
    if (m2 === 'chat') showChatLines()
    else if (m2 === 'random') showRandomView()
    else { usageViewIdx++; applyBubbleLines(buildUsageLines()); fetchUsage() }
    scheduleChat()
  }, iv)
}
// 峰谷显示常驻视图的秒级刷新：倒计时逐秒跳动，峰↔谷切换瞬间视图跟着翻
var peakTickTimer = null
function stopPeakTick() {
  if (peakTickTimer) { clearInterval(peakTickTimer); peakTickTimer = null }
}
function startPeakTick() {
  stopPeakTick()
  if (persistMode() !== 'peak' || !bubbleShown || !bubbleOn) return
  peakTickTimer = setInterval(function () {
    if (persistMode() !== 'peak' || !bubbleShown || !bubbleOn || costBubbleActive || overrideActive()) { stopPeakTick(); return }
    applyBubbleLines(buildGroup1())
  }, 1000)
}
function saveConfig() {
  try {
    fetch(SIZE_URL, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scale: state.scale, bubbleScale: bubbleScale, fontScale: fontScale, sound: soundOn, vol: soundVol, soundSet: soundSet, usageMode: usageMode, usageSource: usageSource, peakMode: peakMode, bubbleOn: bubbleOn, widgetMode: widgetMode, persistMode: persistModes.length === 4 ? 'random' : persistModes.join(',') || 'none', valleyRemindOn: valleyRemindOn, peakLockOn: peakLockOn, turnCostOn: turnCostOn, turnCostCloseMs: turnCostCloseMs, lockCarouselMs: lockCarouselMs, scrollGapOn: scrollGapOn, scrollGapPx: scrollGapPx }) })
    // 锚点位置记忆：记录相对边框的离边距离，窗口 resize 后保持（localStorage）。
    // v:2 = 净距离格式（剥离避让距离），v:1 旧格式含避让距离，恢复时废弃旧格式。
    var vp = viewport()
    var w = root.offsetWidth || root.getBoundingClientRect().width || 0
    var h = root.offsetHeight || root.getBoundingClientRect().height || 0
    var leftDist = state.left
    var rightDist = vp.w - state.left - w
    var topDist = state.top
    var bottomDist = vp.h - state.top - h
    var hAnchor = leftDist <= rightDist ? 'left' : 'right'
    var hDistRaw = Math.round(Math.min(leftDist, rightDist))
    var hDist = hAnchor === 'right' && scrollGapOn ? Math.max(0, hDistRaw - rightGap()) : hDistRaw
    localStorage.setItem('dshw-pos', JSON.stringify({
      v: 2,
      hAnchor: hAnchor,
      hDist: hDist,
      vAnchor: topDist <= bottomDist ? 'top' : 'bottom',
      vDist: Math.round(Math.min(topDist, bottomDist))
    }))
  } catch (err) {}
}
function setUsageMode(v) {
  usageMode = v === 'token' ? 'token' : 'ledger'
  usageSelect.value = usageMode
  saveConfig()
  refresh(false)
}
function setUsageSource(v) {
  // 前端/校准已合并为单一来源：未配置平台令牌时服务端自动回退纯前端数据（指示灯灰色），
  // 配置令牌后官方数据追上即校准（黄→绿）
  usageSource = 'hybrid'
  sourceSelect.value = usageSource
  saveConfig()
  updateCalibDot()
  if (persistMode() === 'usage') applyUsageView() // 立即按新来源刷新用量视图
}
// 峰谷叫法不再提供菜单选择，跟随 size.json 里的 peakMode（default/liangwen/qiangqiang）
// 应用总开关的可见性：hidden 时隐藏鲸鱼本体与菜单按钮，显示唤回热区，
// 并把菜单切成迷你模式（只留「开关」下拉框）
function applyWidgetVisibility() {
  var hidden = widgetMode === 'hidden'
  root.classList.toggle('dshwv-hidden', hidden)
  hotspot.style.display = hidden ? 'block' : 'none'
  menuBox.classList.toggle('dshwv-menu-mini', hidden)
}
// 三路缩放（气泡/字体/整体）：开关下拉框只负责选目标，大小滑杆/数字框调所选目标的刻度。
// 0 = 隐藏该部分（整体 0 即隐身，悬停右下角热区唤回菜单拉回）。widgetMode 变为派生值，兼容旧可见性逻辑
function syncWidgetMode(boot) {
  var prev = widgetMode
  widgetMode = state.scale <= 0 ? 'hidden' : bubbleScale <= 0 ? 'nobubble' : 'all'
  bubbleOn = widgetMode === 'all'
  if (!boot) {
    if (widgetMode !== 'all' && prev === 'all') {
      // 必须走 hideCostBubble：残留的 costBubbleActive 会让 render()/showBubble() 永久早退
      hideCostBubble()
      hideBubble()
    }
    if (widgetMode === 'all' && prev !== 'all' && persistMode() !== null && !lockActive) showBase()
  }
  applyWidgetVisibility()
  // 注意：这里不重新锚定菜单——拖动整体大小时设置框必须保持原地不动；
  // 隐身恢复后的重锚定由 setPartScale 的 whole 分支按需触发
}
function applyBubbleScale() {
  bubbleBox.style.setProperty('--dshw-bscale', String(bubbleScale))
}
function applyFontScale() {
  textBox.style.setProperty('--dshw-fscale', String(fontScale))
}
// 全局恢复默认：走各 set 函数以复用「应用 + UI 同步 + 持久化」，与出厂状态完全一致
function resetAllDefaults() {
  setVol(1)
  setSoundSet('duck')
  setScrollGapOn(false)
  setPersistMode(null)
  setLockCarousel(3)
  setTurnCostClose(3)
  setTurnCostOn(true)
  setValleyRemind(true)
  setPeakLock(true)
  setUsageMode('ledger')
  setUsageSource('hybrid')
  bubbleScale = 1
  fontScale = 1
  applyBubbleScale()
  applyFontScale()
  updateCalibDot()
  setScale(1)
  syncWidgetMode()
  updateSizeInputs()
  saveConfig()
}
function updateSizeInputs() {
  var s = sizePart === 'bubble' ? bubbleScale : sizePart === 'font' ? fontScale : state.scale
  var lv = scaleToLevel(s)
  scaleInput.value = String(lv)
  scaleNumber.value = String(lv)
}
// 档位（0-20 整数）↔ 实际缩放（0-2.5）：0 = 隐藏，8 ≈ 原始大小，20 = 最大
function scaleToLevel(s) {
  return Math.round(Math.min(MAX_SCALE, Math.max(0, Number(s) || 0)) * 20 / MAX_SCALE)
}
function setPartScale(part, level) {
  if (part !== 'bubble' && part !== 'font' && part !== 'whole') return
  var lv = Math.round(Math.min(20, Math.max(0, Number(level))))
  if (isNaN(lv)) return
  var next = Math.round(lv * MAX_SCALE / 20 * 100) / 100
  if (part === 'bubble') {
    bubbleScale = next
    applyBubbleScale()
    updateSizeInputs()
  } else if (part === 'font') {
    fontScale = next
    applyFontScale()
    updateCalibDot()
    updateSizeInputs()
  } else if (next <= 0) {
    // 整体隐身走可见性开关：--dshw-base 有 122px 下限，纯缩放藏不掉
    state.scale = 0
    root.style.setProperty('--dshw-scale', '0')
    updateSizeInputs()
    syncWidgetMode()
    saveConfig()
    return
  } else {
    var wasHidden = state.scale <= 0
    setScale(next)
    // 隐身时菜单锚定在屏幕右下角，恢复可见后锚回菜单按钮（仅此场景重定位，
    // 纯拖大小不重定位，设置框保持原地不动）
    if (wasHidden && menuOpen) positionMenu()
  }
  syncWidgetMode()
  saveConfig()
}
// 常驻内容多选：勾选/取消某一类
function setPersistPart(id, on) {
  var s = persistOrder(persistModes)
  if (on) {
    if (s.indexOf(id) < 0) s.push(id)
  } else {
    s = s.filter(function (x) { return x !== id })
  }
  setPersistModes(s)
}
function setPersistModes(list) {
  persistModes = persistOrder(list)
  syncPersistChecks()
  persistBox.textContent = persistLabel()
  saveConfig()
  if (bubbleOn && persistModes.length > 0) showBase()
  else if (bubbleShown) {
    if (!bubbleRandomActive) hideBubble()
    else if (bubbleTimer === null) bubbleTimer = setTimeout(hideBubble, BUBBLE_MS)
  }
}
// 兼容旧调用（恢复默认、配置迁移）：null = 无；'random' = 全选；单值 = 单选
function setPersistMode(mode) {
  if (mode === 'random') setPersistModes(['chat', 'balance', 'usage', 'peak'])
  else if (mode === 'peak' || mode === 'balance' || mode === 'usage' || mode === 'chat') setPersistModes([mode])
  else setPersistModes([])
}
function setPeakLock(v) {
  peakLockOn = !!v
  peakLockToggle.checked = peakLockOn
  // 勾选锁定且当前正处于峰时：常驻自动切到峰谷显示；谷时勾选不切换（峰时到来后锁定气泡照常接管）
  if (peakLockOn && localIsPeak() && persistMode() !== 'peak') setPersistMode('peak')
  saveConfig()
  updateLockState()
}
function setValleyRemind(v) {
  valleyRemindOn = !!v
  valleyRemindToggle.checked = valleyRemindOn
  saveConfig()
  updateRemindState()
}
// 谷时提醒状态评估（随锁定监视循环每 5 秒跑一次）：
// 谷时倒计时剩 ≤30 分钟且未处于峰时锁定时触发；峰时开始或取消勾选自动解除
function updateRemindState() {
  var active = false
  if (valleyRemindOn && !lockActive) {
    var ms = offRemainMs()
    active = ms !== null && ms <= 30 * 60 * 1000
  }
  if (active === remindActive) return
  remindActive = active
  if (remindActive) {
    // 触发：常驻自动切到峰谷显示并一直保持，气泡进入 3+1 提醒轮播
    if (persistMode() !== 'peak') setPersistMode('peak')
    if (bubbleOn) showLockBubble()
  } else {
    // 解除：回常驻视图
    if (bubbleShown && persistMode() !== null) showBase()
    else if (bubbleShown) hideBubble()
  }
}
function setLockCarousel(v) {
  var n = Math.max(0, Math.round(Number(v) || 0))
  lockCarouselMs = n * 1000
  lockCarInput.value = String(n)
  saveConfig()
  // 锁定气泡正在显示时立即按新间隔重启轮播；填 0 则停在当前视图不再切换
  // （若正停在倒计时视图，秒级校时器保留，倒计时继续走）
  if (lockActive && bubbleShown && !costBubbleActive) {
    if (lockCarouselMs <= 0) {
      stopLockCarousel()
    } else {
      scheduleLockCarousel()
      startLockTick()
    }
  } else if (!lockActive && bubbleShown && !costBubbleActive && (persistMode() === 'chat' || persistMode() === 'random')) {
    // 常驻对话/随机内容正在展示：按新间隔立即重启轮播（0 = 停在当前内容）
    scheduleChat()
  }
}
function setTurnCostOn(v) {
  turnCostOn = !!v
  turnCostToggle.checked = turnCostOn
  turnCostCloseInput.disabled = !turnCostOn
  saveConfig()
  if (!turnCostOn) hideCostBubble()
}
function setTurnCostClose(v) {
  if (!turnCostOn) return
  var n = Math.max(0, Math.round(Number(v) || 0))
  turnCostCloseMs = n * 1000
  turnCostCloseInput.value = String(n)
  saveConfig()
}
function setScrollGapOn(v) {
  scrollGapOn = !!v
  scrollGapToggle.checked = scrollGapOn
  scrollGapInput.disabled = !scrollGapOn
  saveConfig()
  settle()
}
function setScrollGapPx(v) {
  if (!scrollGapOn) return
  var n = Math.max(0, Math.round(Number(v) || 0))
  scrollGapPx = n
  scrollGapInput.value = String(n)
  saveConfig()
  settle()
}
function setScale(v) {
  var next = Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(v))) * 10) / 10
  // 缩放测量需要 left/top 立即到位：临时禁用过渡（滚轮/数字框路径没有
  // 滑块 pointerdown 的 transition:none，否则 r2 测的是过渡起点导致错锚点）
  var prevTrans = root.style.transition
  root.style.transition = 'none'
  var rect = root.getBoundingClientRect()
  // fixed point: the whale's corner — bottom-right when unflipped, bottom-left
  // when flipped. Growing extends the widget up-left / up-right from that
  // corner; shrinking pulls it back toward the corner. The whale always hugs
  // its corner while scaling.
  var fx = state.h === 'left' ? rect.left : rect.right
  var fy = rect.bottom
  state.scale = next
  root.style.setProperty('--dshw-scale', String(next))
  scaleInput.value = String(scaleToLevel(next))
  scaleNumber.value = String(scaleToLevel(next))
  saveConfig()
  // keep the corner fixed while resizing; the position correction applies
  // instantly because the caller disables the transition for the whole drag
  var r2 = root.getBoundingClientRect()
  var vp = viewport()
  if (state.h === 'left') {
    state.left = Math.min(Math.max(fx, 0), Math.max(0, vp.w - r2.width))
  } else {
    state.left = Math.min(Math.max(fx - r2.width, 0), Math.max(0, vp.w - r2.width))
  }
  state.top = Math.min(Math.max(fy - r2.height, 0), Math.max(0, vp.h - r2.height))
  express()
  // 恢复过渡必须延迟到下一帧：本帧 left/top 已在 none 下设置并提交，
  // 立即恢复会让浏览器对「刚改过的 left/top」重新评估并播放过渡动画
  // （翻转时叠加 transform .3s 更明显，表现为抽搐）。
  requestAnimationFrame(function () {
    root.style.transition = prevTrans
  })
}
function setVol(v) {
  var next = Math.round(Math.min(1, Math.max(0, Number(v))) * 100) / 100
  soundVol = next
  soundOn = next > 0
  volInput.value = String(next)
  volPct.textContent = Math.round(next * 100) + '%'
  try {
    if (pressAudio) pressAudio.volume = next
    if (releaseAudio) releaseAudio.volume = next
  } catch (err) {}
  saveConfig()
}
function setSoundSet(v) {
  soundSet = v === 'fx1' ? 'fx1' : 'duck'
  soundSelect.value = soundSet
  applySoundSet()
  saveConfig()
}
var SQUISH = 'scaleY(0.88) scaleX(1.05)'
var pressAudio = null
var releaseAudio = null
var pressing = false
var pressEnded = false
var releasePlayed = false
var releaseTimer = null
function applySoundSet() {
  try {
    pressAudio = new Audio('/dsh-whale/sound/press.mp3?set=' + soundSet)
    pressAudio.preload = 'auto'
    pressAudio.volume = soundVol
    releaseAudio = new Audio('/dsh-whale/sound/release.mp3?set=' + soundSet)
    releaseAudio.preload = 'auto'
    releaseAudio.volume = soundVol
  } catch (err) {}
}
function playPress() {
  if (!pressAudio || !soundOn) return
  try {
    if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null }
    if (releaseAudio) {
      releaseAudio.pause()
      releaseAudio.currentTime = 0
    }
    pressEnded = false
    releasePlayed = false
    pressAudio.onended = function () {
      pressEnded = true
      // fallback (duration unknown): click → Ya2 right after Ya1 ends
      if (!pressing && !releasePlayed) playRelease()
      // hold: still pressed → wait for pressUp()
    }
    pressAudio.currentTime = 0
    var p = pressAudio.play()
    if (p && typeof p.catch === 'function') p.catch(function () {})
  } catch (err) {}
}
function playRelease() {
  if (releasePlayed || !releaseAudio || !soundOn) return
  releasePlayed = true
  try {
    releaseAudio.currentTime = 0
    var p = releaseAudio.play()
    if (p && typeof p.catch === 'function') p.catch(function () {})
  } catch (err) {}
}
function pressDown() {
  body.style.transform = SQUISH
  pressing = true
  playPress()
}
function pressUp() {
  body.style.transform = 'scaleY(1) scaleX(1)'
  pressing = false
  if (pressEnded) {
    // hold (or released after Ya1 finished) → Ya2 now
    playRelease()
    return
  }
  // click: start Ya2 in the last 100ms of Ya1's playback
  var durKnown = false
  var remainMs = 0
  try {
    var dur = pressAudio ? pressAudio.duration : 0
    if (isFinite(dur) && dur > 0) {
      durKnown = true
      remainMs = (dur - pressAudio.currentTime) * 1000
    }
  } catch (err) {}
  if (durKnown) {
    releaseTimer = setTimeout(function () {
      releaseTimer = null
      playRelease()
    }, Math.max(0, remainMs - 100))
  }
  // duration unknown → pressAudio.onended fallback plays Ya2 after Ya1 ends
}
var menuOpen = false
function toggleMenu() {
  menuOpen = !menuOpen
  if (menuOpen) positionMenu()
  menuBox.classList.toggle('dshwv-menu-open', menuOpen)
  if (menuOpen) menuBtn.classList.add('dshwv-menu-btn-visible')
}
function closeMenu() {
  menuOpen = false
  menuBox.classList.remove('dshwv-menu-open')
  persistPop.classList.remove('dshwv-open')
  root.style.transition = ''
  snapCheck()
}
function snapCheck() {
  var rect = root.getBoundingClientRect()
  var vp = viewport()
  var w = rect.width, h = rect.height
  var left = rect.left, top = rect.top
  var centerX = left + w / 2
  var centerY = top + h / 2
  var moved = false
  if (centerX < vp.w / 4) {
    state.h = 'left'
    state.hOff = 0
    left = 0
    moved = true
  } else if (centerX > vp.w * 3 / 4) {
    state.h = 'right'
    state.hOff = 0
    left = vp.w - w - rightGap()
    moved = true
  } else {
    state.h = null
    state.hOff = left
  }
  if (centerY < vp.h / 4) {
    state.v = 'top'
    state.vOff = 0
    top = 0
    moved = true
  } else {
    state.v = 'bottom'
    state.vOff = Math.max(0, vp.h - top - h)
  }
  if (moved) {
    state.left = left
    state.top = top
    settle()
  }
}
function positionMenu() {
  try {
    var vp = viewport()
    // 隐身模式：菜单按钮已被隐藏（rect 全 0），菜单固定锚定屏幕右下角
    if (widgetMode === 'hidden') {
      menuBox.style.left = 'auto'
      menuBox.style.right = '10px'
      menuBox.style.top = 'auto'
      menuBox.style.bottom = '10px'
      menuBox.style.transformOrigin = 'bottom right'
      return
    }
    var r = root.getBoundingClientRect()
    var b = menuBtn.getBoundingClientRect()
    var vp = viewport()
    var onLeft = r.left + r.width / 2 < vp.w / 2
    // the menu appears ABOVE the button, anchored to its side:
    // right side → menu bottom-right aligns with the button's top-right;
    // left side → menu bottom-left aligns with the button's top-left
    if (onLeft) {
      menuBox.style.left = b.left + 'px'
      menuBox.style.right = 'auto'
      menuBox.style.transformOrigin = 'bottom left'
    } else {
      menuBox.style.right = (vp.w - b.right) + 'px'
      menuBox.style.left = 'auto'
      menuBox.style.transformOrigin = 'bottom right'
    }
    menuBox.style.bottom = (vp.h - b.top) + 'px'
    menuBox.style.top = 'auto'
  } catch (err) {}
}

var hitCanvas = null
var hitReady = false
function setupHitTest() {
  try {
    hitCanvas = document.createElement('canvas')
    hitCanvas.width = 610
    hitCanvas.height = 610
    var probe = new Image()
    probe.onload = function () {
      try {
        // 拉伸到 610×610 与 isWhaleHit 的坐标映射对齐；不指定尺寸会按原图大小绘制，
        // 回退到非 610×610 素材（如 DSniang02.png）时命中区域会错位
        hitCanvas.getContext('2d').drawImage(probe, 0, 0, 610, 610)
        hitReady = true
      } catch (err) {}
    }
    probe.onerror = function () {}
    probe.src = IMG_URL
  } catch (err) {}
}
function isWhaleHit(e) {
  if (!hitCanvas || !hitReady) return true
  try {
    var r = img.getBoundingClientRect()
    if (!r || r.width <= 0 || r.height <= 0) return false
    var lx = (e.clientX - r.left) / r.width * 610
    var ly = (e.clientY - r.top) / r.height * 610
    if (lx < 0 || ly < 0 || lx >= 610 || ly >= 610) return false
    if (state.h === 'left') lx = 610 - lx
    var data = hitCanvas.getContext('2d').getImageData(Math.floor(lx), Math.floor(ly), 1, 1).data
    return data[3] > 10
  } catch (err) {
    return true
  }
}
function onDocPointerDown(e) {
  if (e.target && e.target.closest) {
    if (e.target.closest('.dshwv-bubble') || e.target.closest('.dshwv-menu') || e.target.closest('.dshwv-menu-btn') || e.target.closest('.dshwv-hotspot')) return
  }
  if (menuOpen) {
    closeMenu()
    return
  }
  if (e.button !== 0 && e.pointerType === 'mouse') return
  if (!isWhaleHit(e)) return
  try { e.preventDefault(); e.stopPropagation() } catch (err) {}
  var vp = viewport()
  var rect = root.getBoundingClientRect()
  drag = { active: true, startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top, w: rect.width, h: rect.height, moved: false, vp: vp }
  root.classList.add('dshwv-dragging')
  pressDown()
  setWidgetCursor('grabbing')
  document.addEventListener('pointermove', onDocPointerMove, true)
  document.addEventListener('pointerup', onDocPointerUp, true)
  document.addEventListener('pointercancel', onDocPointerCancel, true)
}
function onDocPointerMove(e) {
  if (!drag || !drag.active) return
  var dx = e.clientX - drag.startX
  var dy = e.clientY - drag.startY
  if (dx * dx + dy * dy >= CLICK_SQ) drag.moved = true
  // Keep the pre-drag flip orientation while dragging (state.h/v stay as they
  // were); on release endDrag() recomputes the anchors and settle() flips the
  // class with a smooth transition instead of reverting instantly.
  state.left = clamp(drag.origLeft + dx, 0, Math.max(0, drag.vp.w - drag.w))
  state.top = clamp(drag.origTop + dy, 0, Math.max(0, drag.vp.h - drag.h))
  express()
}
function onDocPointerUp(e) {
  // 拦截鲸鱼区域内的 pointerup：防止下方元素（如文件行）监听 pointerup 穿透误触发
  try { if (isWhaleHit(e)) { e.preventDefault(); e.stopPropagation() } } catch (err) {}
  endDrag(e, true)
}
function onDocPointerCancel(e) { endDrag(e, false) }
function onDocClickStopper(e) {
  // 只在鲸鱼命中区域拦截 click（保持透明区 pass-through）。
  // 持久注册（不随 endDrag 移除）——click 在 pointerup 之后派发，
  // 若在 endDrag 移除会导致 click 穿透到下方元素（如误打开文件）。
  if (!isWhaleHit(e)) return
  try { e.preventDefault(); e.stopPropagation() } catch (err) {}
}
document.addEventListener('pointerdown', onDocPointerDown, true)
document.addEventListener('click', onDocClickStopper, true)

var widgetCursor = ''
function setWidgetCursor(v) {
  if (v !== widgetCursor) {
    widgetCursor = v
    try { document.body.style.cursor = v } catch (err) {}
  }
}
function onDocPointerMoveCursor(e) {
  if (drag && drag.active) { setWidgetCursor('grabbing'); return }
  var el = null
  try { el = document.elementFromPoint(e.clientX, e.clientY) } catch (err) {}
  if (el && el.closest && (el.closest('.dshwv-bubble') || el.closest('.dshwv-menu') || el.closest('.dshwv-menu-btn'))) {
    setWidgetCursor('')
    menuBtn.classList.add('dshwv-menu-btn-visible')
    return
  }
  var over = isWhaleHit(e)
  setWidgetCursor(over ? 'grab' : '')
  menuBtn.classList.toggle('dshwv-menu-btn-visible', over || menuOpen)
}
document.addEventListener('pointermove', onDocPointerMoveCursor, true)

function endDrag(e, clickAllowed) {
  if (!drag || !drag.active) return
  drag.active = false
  document.removeEventListener('pointermove', onDocPointerMove, true)
  document.removeEventListener('pointerup', onDocPointerUp, true)
  document.removeEventListener('pointercancel', onDocPointerCancel, true)
  pressUp()
  root.classList.remove('dshwv-dragging')
  setWidgetCursor(isWhaleHit(e) ? 'grab' : '')
  if (clickAllowed && !drag.moved) { showBubble(); refresh(true); return }
  var dx = e.clientX - drag.startX
  var dy = e.clientY - drag.startY
  var left = clamp(drag.origLeft + dx, 0, Math.max(0, drag.vp.w - drag.w))
  var top = clamp(drag.origTop + dy, 0, Math.max(0, drag.vp.h - drag.h))
  var centerX = left + drag.w / 2
  var centerY = top + drag.h / 2
  if (centerX < drag.vp.w / 4) {
    state.h = 'left'
    state.hOff = 0
  } else if (centerX > drag.vp.w * 3 / 4) {
    state.h = 'right'
    state.hOff = 0
  } else {
    state.h = null
    state.hOff = left
  }
  if (centerY < drag.vp.h / 4) {
    state.v = 'top'
    state.vOff = 0
  } else if (centerY > drag.vp.h * 3 / 4) {
    state.v = 'bottom'
    state.vOff = 0
  } else {
    state.v = null
    state.vOff = top
  }
  state.left = left
  state.top = top
  settle()
  // 拖拽结束立即保存锚点位置（否则刷新/关闭后位置回退到上次改菜单时）
  saveConfig()
}
// 窗口尺寸变化时：自由位置的鲸鱼按相对边框锚点重算（保持离边距离，窗口恢复原状即回原位）；
// 贴边吸附的鲸鱼走 settle()（保持贴边）
function applyAnchorPos() {
  try {
    var a = JSON.parse(localStorage.getItem('dshw-pos') || 'null')
    if (!a || a.v !== 2 || (a.hAnchor !== 'left' && a.hAnchor !== 'right') || typeof a.hDist !== 'number' ||
        (a.vAnchor !== 'top' && a.vAnchor !== 'bottom') || typeof a.vDist !== 'number') return false
    var vp = viewport()
    var w = root.offsetWidth || root.getBoundingClientRect().width || 0
    var h = root.offsetHeight || root.getBoundingClientRect().height || 0
    // 与加载恢复一致：锚点存净距离，右锚点按当前避让开关叠加
    var effectiveRightDist = a.hAnchor === 'right' ? a.hDist + (scrollGapOn ? rightGap() : 0) : a.hDist
    var l = a.hAnchor === 'left' ? a.hDist : vp.w - effectiveRightDist - w
    var t = a.vAnchor === 'top' ? a.vDist : vp.h - a.vDist - h
    state.left = clamp(l, 0, Math.max(0, vp.w - w))
    state.top = clamp(t, 0, Math.max(0, vp.h - h))
    state.h = a.hAnchor
    state.hOff = 0
    state.v = a.vAnchor
    state.vOff = 0
    express()
    return true
  } catch (err) { return false }
}
window.addEventListener('resize', function () {
  if (state.h === null && state.v === null && applyAnchorPos()) return
  settle()
})

var rect0 = root.getBoundingClientRect()
state.left = rect0.left
state.top = rect0.top
express()
render()
applySoundSet()
setupHitTest()
fetch(SIZE_URL, { cache: 'no-store' })
  .then(function (r) { return r.json() })
  .then(function (d) {
    if (d && typeof d.scale === 'number' && d.scale >= MIN_SCALE - 0.1 && d.scale <= MAX_SCALE + 0.1) {
      state.scale = d.scale
      root.style.setProperty('--dshw-scale', String(d.scale))
      scaleInput.value = String(scaleToLevel(d.scale))
      scaleNumber.value = String(scaleToLevel(d.scale))
      settle()
    }
    if (d && typeof d.vol === 'number') {
      soundVol = d.vol
      soundOn = soundVol > 0
      volInput.value = String(soundVol)
      volPct.textContent = Math.round(soundVol * 100) + '%'
      try {
        if (pressAudio) pressAudio.volume = soundVol
        if (releaseAudio) releaseAudio.volume = soundVol
      } catch (err) {}
    }
    if (d && typeof d.soundSet === 'string') {
      soundSet = d.soundSet === 'fx1' ? 'fx1' : 'duck'
      soundSelect.value = soundSet
      applySoundSet()
    }
    if (d && typeof d.usageMode === 'string') {
      usageMode = d.usageMode === 'token' ? 'token' : 'ledger'
      usageSelect.value = usageMode
    }
    if (d && typeof d.usageSource === 'string') {
      // 前端/校准已合并：无论旧配置存的是什么，一律走 hybrid（无令牌自动回退纯前端数据）
      usageSource = 'hybrid'
      sourceSelect.value = usageSource
    }
    if (d && typeof d.peakMode === 'string') {
      peakMode = d.peakMode === 'liangwen' || d.peakMode === 'qiangqiang' ? d.peakMode : 'default'
      // 峰谷显示视图的初始叫法跟随配置里的 peakMode
      var psi = PEAK_STYLES.indexOf(peakMode)
      if (psi >= 0) peakStyleIdx = psi
    }
    // 三路缩放：读新字段 bubbleScale/fontScale；兼容旧 widgetMode 三态与 bubbleOn=false（迁移为对应刻度 0）
    var legacyMode = d && typeof d.widgetMode === 'string' && (d.widgetMode === 'all' || d.widgetMode === 'nobubble' || d.widgetMode === 'hidden') ? d.widgetMode : (d && d.bubbleOn === false ? 'nobubble' : 'all')
    if (d && typeof d.bubbleScale === 'number' && d.bubbleScale >= 0) bubbleScale = Math.min(MAX_SCALE, Math.round(d.bubbleScale * 10) / 10)
    else if (legacyMode === 'nobubble') bubbleScale = 0
    if (d && typeof d.fontScale === 'number' && d.fontScale >= 0) fontScale = Math.min(MAX_SCALE, Math.round(d.fontScale * 10) / 10)
    if (legacyMode === 'hidden' && !(d && typeof d.bubbleScale === 'number') && state.scale > 0) {
      // 旧「关闭小鲸鱼」没有记住原刻度，统一落回 0（隐身），拉回 1 恢复
      state.scale = 0
      root.style.setProperty('--dshw-scale', '0')
      scaleInput.value = '0'
      scaleNumber.value = '0'
    }
    bubbleOn = state.scale > 0 && bubbleScale > 0
    applyBubbleScale()
    applyFontScale()
    syncWidgetMode(true)
    updateSizeInputs()
    // 常驻内容多选：'none' = 无；'random' = 全选；逗号分隔 = 组合；兼容旧单选值与 bubbleStayOn/peakShowOn
    {
      var pm = []
      if (d && typeof d.persistMode === 'string') {
        if (d.persistMode === 'none') pm = []
        else if (d.persistMode === 'random') pm = ['chat', 'balance', 'usage', 'peak']
        else if (d.persistMode.indexOf(',') >= 0) pm = d.persistMode.split(',')
        else if (d.persistMode === 'peak' || d.persistMode === 'balance' || d.persistMode === 'usage' || d.persistMode === 'chat') pm = [d.persistMode]
      } else if (d && d.peakShowOn === true) pm = ['peak']
      else if (d && d.bubbleStayOn === true) pm = ['balance']
      persistModes = persistOrder(pm)
      syncPersistChecks()
      persistBox.textContent = persistLabel()
    }
    if (d && typeof d.peakLockOn === 'boolean') {
      peakLockOn = d.peakLockOn
      peakLockToggle.checked = peakLockOn
    }
    if (d && typeof d.valleyRemindOn === 'boolean') {
      valleyRemindOn = d.valleyRemindOn
      valleyRemindToggle.checked = valleyRemindOn
    }
    if (d && typeof d.turnCostOn === 'boolean') {
      turnCostOn = d.turnCostOn
      turnCostToggle.checked = turnCostOn
      turnCostCloseInput.disabled = !turnCostOn
    }
    if (d && typeof d.turnCostCloseMs === 'number') {
      turnCostCloseMs = d.turnCostCloseMs > 0 ? d.turnCostCloseMs : 0
      turnCostCloseInput.value = String(Math.round(turnCostCloseMs / 1000))
    }
    if (d && typeof d.lockCarouselMs === 'number') {
      lockCarouselMs = d.lockCarouselMs > 0 ? d.lockCarouselMs : 0
      lockCarInput.value = String(Math.round(lockCarouselMs / 1000))
    }
    if (d && typeof d.scrollGapOn === 'boolean') {
      scrollGapOn = d.scrollGapOn
      scrollGapToggle.checked = scrollGapOn
      scrollGapInput.disabled = !scrollGapOn
    }
    if (d && typeof d.scrollGapPx === 'number') {
      scrollGapPx = d.scrollGapPx > 0 ? Math.round(d.scrollGapPx) : 0
      scrollGapInput.value = String(scrollGapPx)
    }
    // 配置恢复后立即判定锁定状态；常驻模式开启时恢复常驻气泡
    updateLockState()
    if (persistMode() !== null && bubbleOn && !lockActive) showBase()
    // 相对边框恢复（localStorage 锚点）：窗口变化后保持离边距离。
    // 仅认 v:2 净距离格式；旧格式（含避让距离）废弃，挂件保持默认右下角吸附。
    // 恢复时还原吸附状态（hAnchor/vAnchor → state.h/v），避免挂件变自由位置
    // 导致避让调节不实时（settle 自由分支只 clamp 不重算位置）。
    try {
      var a = JSON.parse(localStorage.getItem('dshw-pos') || 'null')
      if (a && a.v === 2 && (a.hAnchor === 'left' || a.hAnchor === 'right') && typeof a.hDist === 'number' &&
          (a.vAnchor === 'top' || a.vAnchor === 'bottom') && typeof a.vDist === 'number') {
        var vpA = viewport()
        var wA = root.offsetWidth || root.getBoundingClientRect().width || 0
        var hA = root.offsetHeight || root.getBoundingClientRect().height || 0
        // 锚点存的是净距离：右锚点按当前避让开关叠加避让距离
        var effectiveRightDist = a.hAnchor === 'right' ? a.hDist + (scrollGapOn ? rightGap() : 0) : a.hDist
        var lA = a.hAnchor === 'left' ? a.hDist : vpA.w - effectiveRightDist - wA
        var tA = a.vAnchor === 'top' ? a.vDist : vpA.h - a.vDist - hA
        state.left = clamp(lA, 0, Math.max(0, vpA.w - wA))
        state.top = clamp(tA, 0, Math.max(0, vpA.h - hA))
        // 按锚点还原吸附状态（贴边锚点 → 吸附；自由位锚点 → 自由）
        state.h = a.hAnchor
        state.hOff = 0
        state.v = a.vAnchor
        state.vOff = 0
        settle()
      }
    } catch (err) {}
    refresh(false)
  })
  .catch(function () { refresh(false) })
setInterval(function () { refresh(false) }, REFRESH_MS)
// 启动锁定监控（读取配置后判定初始状态），常驻模式开启时直接弹常驻气泡
startLockWatch()
if (persistMode() !== null && bubbleOn && !lockActive) showBase()

// —— 每轮对话消耗检测：轮询 last-turn.json，出现新 seq 时弹消耗金额泡泡 ——
var LAST_TURN_URL = '/dsh-whale/last-turn.json'
var lastCostSeq = 0
var lastCostAligned = false
function pollLastTurn() {
  try {
    fetch(LAST_TURN_URL, { cache: 'no-store' })
      .then(function (r) { return r.json() })
      .then(function (d) {
        if (!d || !d.ok || typeof d.seq !== 'number') return
        if (!lastCostAligned) {
          // 首次拿到数据：只对齐 seq，不弹旧轮次
          lastCostSeq = d.seq
          lastCostAligned = true
          return
        }
        if (d.seq > lastCostSeq) {
          lastCostSeq = d.seq
          if (d.turn !== null && d.amount !== null) {
            showCostBubble(Number(d.amount))
          }
        }
      })
      .catch(function () {})
  } catch (err) {}
}
setInterval(pollLastTurn, 1000)
})()`


const name = 'whale-balance-widget'
const inject = ['webServer', 'credentials']

function apply(ctx) {
    let imageBytes = null
    let balanceCache = null
    let balanceInFlight = null
    let gifBytes = null
    // 每轮对话消耗统计：按 (session.id, turn) 分桶聚合，完成后写入 lastTurn。
    // 用 Map 分桶避免主会话与子代理（spawn/fork）并行时串账。
    let turnAggs = new Map() // sessionId -> { turn, cost, tokens, lastTs }
    let lastTurn = null // { turn, amount, tokens, ts }
    let lastTurnSeq = 0

    // —— Token 用量统计账本：按 模型 × 今日/本月 分桶，跨天/跨月自动归零 ——
    // 桶结构：{ cache, miss, out, reasoning, costCache, costMiss, costOut }
    function bjDateStr() {
      return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
    }
    // 结构：{ version:2, date, monthKey, today:{模型:桶}, month:{模型:桶} }
    // monthKey（月份标记字符串）与 month（分桶容器）分开命名——旧版共用 month 键导致
    // 分桶每次被重置（撞键 bug）。读入旧结构时按 monthKey 缺失处理，自动清一次本月分桶
    function loadTokenStats() {
      const today = bjDateStr()
      const monthKey = today.slice(0, 7)
      try {
        const parsed = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'))
        if (parsed && typeof parsed === 'object') {
          if (parsed.date !== today) parsed.today = {}
          if (parsed.monthKey !== monthKey) parsed.month = {}
          parsed.version = 2
          parsed.date = today
          parsed.monthKey = monthKey
          if (!parsed.today || typeof parsed.today !== 'object') parsed.today = {}
          if (!parsed.month || typeof parsed.month !== 'object') parsed.month = {}
          // 兼容旧账本：补齐缺失/非法的分项字段（如旧数据无 costReasoning 会累加成 NaN）
          const sanitize = (periodMap) => {
            for (const k of Object.keys(periodMap || {})) {
              const b = periodMap[k] || {}
              for (const f of ['cache', 'miss', 'out', 'reasoning', 'costCache', 'costMiss', 'costOut', 'costReasoning']) {
                b[f] = Number(b[f]) || 0
              }
              periodMap[k] = b
            }
          }
          sanitize(parsed.today)
          sanitize(parsed.month)
          return parsed
        }
      } catch (err) {}
      return { version: 2, date: today, monthKey: monthKey, today: {}, month: {} }
    }
    let tokenStats = loadTokenStats()
    function saveTokenStats() {
      try { fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokenStats), 'utf8') } catch (err) {}
    }
    function ensureTokenPeriods() {
      const today = bjDateStr()
      const monthKey = today.slice(0, 7)
      if (tokenStats.date !== today) { tokenStats.date = today; tokenStats.today = {} }
      if (tokenStats.monthKey !== monthKey) { tokenStats.monthKey = monthKey; tokenStats.month = {} }
    }
    function tokenBucket(period, model) {
      ensureTokenPeriods()
      const p = tokenStats[period] || (tokenStats[period] = {})
      return p[model] || (p[model] = { cache: 0, miss: 0, out: 0, reasoning: 0, costCache: 0, costMiss: 0, costOut: 0, costReasoning: 0 })
    }

    function finalizeTurn(sessionId) {
      const agg = turnAggs.get(sessionId)
      if (agg && agg.cost > 0) {
        lastTurn = { turn: agg.turn, amount: agg.cost, tokens: agg.tokens, ts: agg.lastTs }
        lastTurnSeq++
      }
      turnAggs.delete(sessionId)
      saveTokenStats() // 本轮结算即落盘，重启不丢统计
    }
    // 监听会话事件流：assistant/message 携带每步真实 usage，按 (session,turn) 聚合；
    // turn/end 时结算该会话本轮并写入 lastTurn
    function handleSessionEvent(sessionId, event) {
      try {
        const type = event && event.type
        const d = event && event.data
        if (!d || typeof d !== 'object') return
        if (type === 'turn/end') {
          finalizeTurn(sessionId)
          return
        }
        if (type !== 'assistant/message') return
        const turn = Number(d.turn)
        const usage = d.usage
        if (!usage || typeof usage !== 'object' || !isFinite(turn)) return
        const model = d.message && d.message.source ? d.message.source.model : ''
        const input = Number(usage.inputTokens) || 0
        const cache = Number(usage.cacheReadTokens) || 0
        const output = Number(usage.outputTokens) || 0
        const reasoning = Number(usage.reasoningTokens) || 0
        let agg = turnAggs.get(sessionId)
        if (!agg || agg.turn !== turn) {
          if (agg) finalizeTurn(sessionId)
          agg = { turn, cost: 0, tokens: 0, lastTs: Date.now() }
          turnAggs.set(sessionId, agg)
        }
        // 定价换算（CNY/百万 token；缓存命中=输入价，其余按各自档位）。
        // 思考 token 是 outputTokens 的子集（DSH 前端即按 reasoningTokens ≤ outputTokens 校验，
        // 官方 RESPONSE_TOKEN 也含思考），所以不单独计数、不单独计价，否则每轮消耗会多算一份思考的钱。
        const p = priceFor(model)
        const off = isPeakTime(Math.floor(Date.now() / 1000)) ? 1 : 0
        const costCache = (cache / 1e6) * p.hit[off]
        const costMiss = (input / 1e6) * p.miss[off]
        const costOut = (output / 1e6) * p.out[off]
        agg.tokens += input + cache + output
        agg.cost += costCache + costMiss + costOut
        agg.lastTs = Date.now()
        // 用量统计账本：按模型累计 token 明细与分项金额（今日/本月各一份）；
        // 只统计 DeepSeek 模型（其他模型/未知模型不计入）
        if ((cache || input || output || reasoning) && /deepseek/i.test(model)) {
          for (const period of ['today', 'month']) {
            const b = tokenBucket(period, model)
            b.cache += cache
            b.miss += input
            b.out += output
            b.reasoning += reasoning
            b.costCache += costCache
            b.costMiss += costMiss
            b.costOut += costOut
          }
        }
      } catch (err) {}
    }

    // 监听所有会话的追加事件；按会话 id 分桶，turn/end 时结算该会话本轮
    const disposers = []
    disposers.push(ctx.on('session/event', (session, event) => {
      const sid = session && session.id ? session.id : 'default'
      handleSessionEvent(sid, event)
    }))
    // 会话销毁时清理残留聚合，避免内存泄漏
    disposers.push(ctx.on('session/disposed', (session) => {
      if (session && session.id) turnAggs.delete(session.id)
    }))

    function loadGif() {
      if (gifBytes) return gifBytes
      for (const p of RUA_GIF_CANDIDATES) {
        try {
          const bytes = fs.readFileSync(p)
          if (bytes && bytes.length > 0) {
            gifBytes = bytes
            return bytes
          }
        } catch (err) {}
      }
      throw new Error('rua gif not found')
    }

    function loadImage() {
      if (imageBytes) return imageBytes
      for (const p of IMAGE_CANDIDATES) {
        try {
          const bytes = fs.readFileSync(p)
          if (bytes && bytes.length > 0) {
            imageBytes = bytes
            return bytes
          }
        } catch (err) {}
      }
      throw new Error('whale image not found')
    }

    function pickBalanceInfo(infos) {
      if (!Array.isArray(infos) || infos.length === 0) return null
      const num = (x) => (x && x.total_balance !== undefined ? Number(x.total_balance) : NaN)
      return (
        infos.find((x) => x && x.currency === 'CNY' && num(x) > 0) ||
        infos.find((x) => num(x) > 0) ||
        infos.find((x) => x && x.currency === 'CNY') ||
        infos[0]
      )
    }

    async function fetchBalance() {
      let cred
      try {
        cred = await ctx.credentials.resolve('DEEPSEEK_API_KEY')
      } catch (err) {
        return { ok: false, code: 'NO_KEY', error: '凭据读取失败: ' + String((err && err.message) || err).slice(0, 160) }
      }
      if (!cred) {
        return { ok: false, code: 'NO_KEY', error: '未配置 DEEPSEEK_API_KEY' }
      }
      let lastErr = null
      for (let attempt = 0; attempt < 2; attempt++) {
        let res
        try {
          res = await fetch(BALANCE_URL, {
            headers: { Authorization: 'Bearer ' + cred.value },
            signal: AbortSignal.timeout(20000),
          })
        } catch (err) {
          lastErr = err
          if (attempt === 0) await new Promise((r) => setTimeout(r, 500))
          continue
        }
        if (!res.ok) {
          lastErr = new Error('HTTP ' + res.status)
          if (res.status < 500) break
          if (attempt === 0) await new Promise((r) => setTimeout(r, 500))
          continue
        }
        let data
        try {
          data = await res.json()
        } catch (err) {
          return { ok: false, code: 'PARSE', error: '余额接口返回不是合法 JSON' }
        }
        const info = pickBalanceInfo(data && data.balance_infos)
        if (!info || info.total_balance === undefined) {
          return { ok: false, code: 'SHAPE', error: '余额接口返回结构异常' }
        }
        return {
          ok: true,
          totalBalance: Number(info.total_balance),
          currency: String(info.currency || 'CNY'),
          updatedAt: new Date().toISOString(),
        }
      }
      const transient = !(lastErr && /^HTTP 4\d\d/.test(lastErr.message))
      return {
        ok: false,
        code: 'HTTP',
        transient: transient,
        error: '余额接口请求失败: ' + String((lastErr && lastErr.message) || lastErr).slice(0, 200),
      }
    }

    async function fetchUsage() {
      let cred
      try {
        cred = await ctx.credentials.resolve('DEEPSEEK_PLATFORM_TOKEN')
      } catch (err) {
        return { error: 'platform cred resolve failed' }
      }
      if (!cred) return { error: 'no platform token' }
      const token = String(cred.value).replace(/^Bearer\s+/i, '')
      try {
        const now = new Date()
        const tz = -now.getTimezoneOffset() * 60
        const start = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000)
        const end = start + 86400
        const url = 'https://platform.deepseek.com/api/v0/usage/by_api_key/amount?start=' + start + '&end=' + end + '&tz=' + tz
        const res = await fetch(url, {
          headers: { Authorization: 'Bearer ' + token },
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) return { error: 'http ' + res.status }
        const data = await res.json()
        const u = computeTodayUsage(data)
        if (u && isFinite(u.amount)) return { amount: u.amount, tokens: u.tokens }
        return { error: 'no usage' }
      } catch (err) {
        return { error: String((err && err.message) || err) }
      }
    }

    function computeTodayUsage(data) {
      // data.data.biz_data.series[]: [{model, buckets:[{time, usage:{RESPONSE_TOKEN, PROMPT_CACHE_HIT_TOKEN, PROMPT_CACHE_MISS_TOKEN}}]}]
      let d = data
      if (d && d.data && d.data.biz_data && Array.isArray(d.data.biz_data.series)) d = d.data.biz_data
      else if (d && d.data && Array.isArray(d.data.series)) d = d.data
      const series = Array.isArray(d.series) ? d.series : null
      if (!series || series.length === 0) return null
      let cost = 0
      let tokens = 0
      let found = false
      for (const s of series) {
        if (!s || typeof s !== 'object') continue
        const p = priceFor(s.model)
        const buckets = Array.isArray(s.buckets) ? s.buckets : []
        for (const b of buckets) {
          const u = b && b.usage
          if (!u || typeof u !== 'object') continue
          const hit = Number(u.PROMPT_CACHE_HIT_TOKEN) || 0
          const miss = Number(u.PROMPT_CACHE_MISS_TOKEN) || 0
          const out = Number(u.RESPONSE_TOKEN) || 0
          if (hit + miss + out === 0) continue
          found = true
          tokens += hit + miss + out
          const pi = isPeakTime(b.time) ? 1 : 0
          cost += (hit / 1e6) * p.hit[pi] + (miss / 1e6) * p.miss[pi] + (out / 1e6) * p.out[pi]
        }
      }
      return found ? { amount: cost, tokens: tokens } : null
    }

    function todayKey() {
      const d = new Date()
      const p = (n) => String(n).padStart(2, '0')
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    }
    function readUsageLedger() {
      for (const p of USAGE_FILE_CANDIDATES) {
        try {
          const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
          if (parsed && typeof parsed === 'object' && typeof parsed.date === 'string') return parsed
        } catch (err) {}
      }
      return { date: todayKey(), lastBalance: null, todayUsage: 0, history: {} }
    }
    function writeUsageLedger(led) {
      const body = JSON.stringify(led)
      for (const p of USAGE_FILE_CANDIDATES) {
        try {
          fs.writeFileSync(p, body, 'utf8')
          return true
        } catch (err) {}
      }
      return false
    }
    // 记账模式：每次观测到余额后，用余额正差值累计当天用量（跨天自动归零并归档）。
    // 币种感知：观测币种与上次不同时只重置基准、不记差值——数值跳变来自币种
    // 切换而非真实消费（[0] 选币时代 CNY/USD 随机切换曾记出巨额假账，见 #13）。
    function recordLedgerUsage(currentBalance, currency) {
      const t = todayKey()
      let led = readUsageLedger()
      const cur = String(currency || '')
      const currencyChanged =
        typeof led.lastCurrency === 'string' && led.lastCurrency !== '' &&
        cur !== '' && led.lastCurrency !== cur
      if (led.date !== t) {
        if (led.date && typeof led.todayUsage === 'number') {
          led.history = led.history || {}
          led.history[led.date] = led.todayUsage
        }
        led.date = t
        led.lastBalance = currentBalance
        led.lastCurrency = cur
        led.todayUsage = 0
      } else if (currencyChanged) {
        // 币种切换：只换基准，不把差值记成消费
        led.lastBalance = currentBalance
        led.lastCurrency = cur
      } else {
        const prev = typeof led.lastBalance === 'number' ? led.lastBalance : currentBalance
        if (typeof prev === 'number' && typeof currentBalance === 'number' && currentBalance < prev) {
          led.todayUsage = (typeof led.todayUsage === 'number' ? led.todayUsage : 0) + (prev - currentBalance)
        }
        led.lastBalance = currentBalance
        led.lastCurrency = cur
      }
      const keys = Object.keys(led.history || {}).sort()
      while (keys.length > 30) {
        delete led.history[keys.shift()]
      }
      writeUsageLedger(led)
      return led
    }
    function normalizeUsageMode(m) {
      return m === 'token' ? 'token' : 'ledger'
    }

    async function getBalancePayload() {
      const payload = await fetchBalance()
      if (!payload.ok) return payload
      // 无论哪种模式，都先把余额观测记入账本（自动累积「鲸鱼记账」数据）
      const led = recordLedgerUsage(Number(payload.totalBalance), payload.currency)
      const cfg = readSizeConfig() || {}
      const mode = normalizeUsageMode(cfg.usageMode)
      const full = { ...payload }
      full.isPeak = isPeakTime(Math.floor(Date.now() / 1000))
      if (mode === 'ledger') {
        full.todayUsage = led.todayUsage
        full.usageMode = 'ledger'
        return full
      }
      // token：尝试平台令牌实时计算
      let cred = null
      try {
        cred = await ctx.credentials.resolve('DEEPSEEK_PLATFORM_TOKEN')
      } catch (err) {}
      if (cred) {
        const u = await fetchUsage()
        if (u && u.amount !== undefined) {
          full.todayUsage = u.amount
          full.usageMode = 'token'
          return full
        }
      }
      // 无令牌或令牌失败：回落记账模式
      full.todayUsage = led.todayUsage
      full.usageMode = 'ledger'
      return full
    }

    function getBalance() {
      const now = Date.now()
      if (balanceCache && now - balanceCache.at < BALANCE_TTL_MS) {
        return Promise.resolve(balanceCache.payload)
      }
      if (balanceInFlight) return balanceInFlight
      balanceInFlight = getBalancePayload()
        .then((payload) => {
          if (payload.ok) {
            balanceCache = { at: now, payload }
            return payload
          }
          if (payload.transient && balanceCache) {
            // transient network/API blip: keep serving the last known balance
            return { ...balanceCache.payload, stale: true, error: payload.error }
          }
          if (!payload.transient) console.error('[whale-balance]', payload.code, payload.error)
          return payload
        })
        .catch((err) => ({
          ok: false,
          code: 'ERROR',
          error: '余额服务异常: ' + String((err && err.message) || err).slice(0, 200),
        }))
        .finally(() => {
          balanceInFlight = null
        })
      return balanceInFlight
    }

    // 常驻模式归一：新格式 persistMode（'peak'|'balance'|'chat'|null）；
    // 旧格式 bubbleStayOn（balance）/peakShowOn（peak）作迁移输入
    function normalizePersistMode(parsed) {
      if (parsed && typeof parsed.persistMode === 'string') {
        var v = parsed.persistMode
        if (v === 'none') return 'none'
        if (v === 'random') return 'random'
        if (v.indexOf(',') >= 0) {
          const ok = ['chat', 'balance', 'usage', 'peak']
          const parts = v.split(',').filter((x) => ok.indexOf(x) >= 0)
          return parts.length ? parts.join(',') : 'none'
        }
        if (v === 'peak' || v === 'balance' || v === 'usage' || v === 'chat') return v
      }
      return null
    }

    // 总开关归一：'all' | 'nobubble' | 'hidden'；旧格式 bubbleOn === false 迁移为 nobubble
    function normalizeWidgetMode(parsed) {
      if (parsed && typeof parsed.widgetMode === 'string') {
        if (parsed.widgetMode === 'all' || parsed.widgetMode === 'nobubble' || parsed.widgetMode === 'hidden') return parsed.widgetMode
        return 'all'
      }
      return parsed && parsed.bubbleOn === false ? 'nobubble' : 'all'
    }

    // 用量视图统计来源：'local' 前端聚合 | 'hybrid' 校准（官方数据后台校准基线）
    // 兼容：旧配置里的 'official' 一律归入 'hybrid'（官方独立模式已删除）
    function normalizeUsageSource() {
      // 前端/校准已合并为单一来源（hybrid），历史配置里的 local 一律按 hybrid 处理
      return 'hybrid'
    }

    function readSizeConfig() {
      for (const p of SIZE_FILE_CANDIDATES) {
        try {
          const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
          if (parsed && typeof parsed.scale === 'number') {
            return {
              scale: parsed.scale,
              sound: parsed.sound !== false,
              vol: typeof parsed.vol === 'number' ? parsed.vol : 1,
              soundSet: parsed.soundSet === 'fx1' ? 'fx1' : 'duck',
              usageMode: normalizeUsageMode(parsed.usageMode),
              usageSource: normalizeUsageSource(parsed.usageSource),
              peakMode: parsed.peakMode === 'liangwen' || parsed.peakMode === 'qiangqiang' ? parsed.peakMode : 'default',
              bubbleOn: parsed.bubbleOn !== false,
              widgetMode: normalizeWidgetMode(parsed),
              bubbleScale: typeof parsed.bubbleScale === 'number' && parsed.bubbleScale >= 0 ? Math.min(2.5, parsed.bubbleScale) : normalizeWidgetMode(parsed) === 'nobubble' ? 0 : 1,
              fontScale: typeof parsed.fontScale === 'number' && parsed.fontScale >= 0 ? Math.min(2.5, parsed.fontScale) : 1,
              persistMode: normalizePersistMode(parsed),
              peakLockOn: parsed.peakLockOn === true,
              valleyRemindOn: parsed.valleyRemindOn === true,
              turnCostOn: parsed.turnCostOn !== false,
              turnCostCloseMs: typeof parsed.turnCostCloseMs === 'number' ? parsed.turnCostCloseMs : 3000,
              lockCarouselMs: typeof parsed.lockCarouselMs === 'number' ? parsed.lockCarouselMs : 3000,
              scrollGapOn: parsed.scrollGapOn === true,
              scrollGapPx: typeof parsed.scrollGapPx === 'number' ? Math.round(parsed.scrollGapPx) : 17,
            }
          }
        } catch (err) {}
      }
      return null
    }

    function writeSizeConfig(scale, sound, vol, soundSet, usageMode, peakMode, bubbleOn, persistModeVal, valleyRemindOnVal, peakLockOn, turnCostOn, turnCostCloseMs, lockCarouselMs, scrollGapOn, scrollGapPx, widgetModeVal, usageSourceVal, bubbleScaleVal, fontScaleVal) {
      const um = normalizeUsageMode(usageMode)
      const pm = peakMode === 'liangwen' || peakMode === 'qiangqiang' ? peakMode : 'default'
      // 总开关：widgetMode 缺失时按旧字段 bubbleOn 迁移；有值时以它为准并强制 bubbleOn 一致
      const wmo = typeof widgetModeVal === 'string' && (widgetModeVal === 'all' || widgetModeVal === 'nobubble' || widgetModeVal === 'hidden')
        ? widgetModeVal
        : (bubbleOn === false ? 'nobubble' : 'all')
      const bo = wmo === 'all'
      const pmo = persistModeVal === 'peak' || persistModeVal === 'balance' || persistModeVal === 'usage' || persistModeVal === 'chat' || persistModeVal === 'random' ? persistModeVal : null
      const vro = valleyRemindOnVal === true
      const uso = normalizeUsageSource(usageSourceVal)
      const plo = peakLockOn === true
      const tco = turnCostOn !== false
      const tcc = typeof turnCostCloseMs === 'number' ? (turnCostCloseMs > 0 ? turnCostCloseMs : 0) : 3000
      const lcm = typeof lockCarouselMs === 'number' ? (lockCarouselMs > 0 ? lockCarouselMs : 0) : 3000
      const sgo = scrollGapOn === true
      const sgp = typeof scrollGapPx === 'number' && scrollGapPx > 0 ? Math.round(scrollGapPx) : 0
      const bsc = typeof bubbleScaleVal === 'number' && bubbleScaleVal >= 0 ? Math.min(2.5, bubbleScaleVal) : 1
      const fsc = typeof fontScaleVal === 'number' && fontScaleVal >= 0 ? Math.min(2.5, fontScaleVal) : 1
      const body = JSON.stringify({
        scale: scale,
        bubbleScale: bsc,
        fontScale: fsc,
        sound: sound !== false,
        vol: typeof vol === 'number' ? vol : 1,
        soundSet: soundSet === 'fx1' ? 'fx1' : 'duck',
        usageMode: um,
        usageSource: uso,
        peakMode: pm,
        bubbleOn: bo,
        widgetMode: wmo,
        persistMode: pmo,
        peakLockOn: plo,
        valleyRemindOn: vro,
        turnCostOn: tco,
        turnCostCloseMs: tcc,
        lockCarouselMs: lcm,
        scrollGapOn: sgo,
        scrollGapPx: sgp,
        updatedAt: new Date().toISOString(),
      })
      for (const p of SIZE_FILE_CANDIDATES) {
        try {
          fs.writeFileSync(p, body, 'utf8')
          return {
            ok: true,
            scale: scale,
            bubbleScale: bsc,
            fontScale: fsc,
            sound: sound !== false,
            vol: typeof vol === 'number' ? vol : 1,
            soundSet: soundSet === 'fx1' ? 'fx1' : 'duck',
            usageMode: um,
            usageSource: uso,
            peakMode: pm,
            bubbleOn: bo,
            widgetMode: wmo,
            persistMode: pmo,
            peakLockOn: plo,
            valleyRemindOn: vro,
            turnCostOn: tco,
            turnCostCloseMs: tcc,
            lockCarouselMs: lcm,
            scrollGapOn: sgo,
            scrollGapPx: sgp,
          }
        } catch (err) {}
      }
      return { ok: false, error: '无法持久化挂件尺寸' }
    }

    function readBody(req) {
      return new Promise((resolve, reject) => {
        const chunks = []
        let size = 0
        req.on('data', (c) => {
          size += c.length
          if (size > 8192) {
            reject(new Error('body too large'))
            req.destroy()
            return
          }
          chunks.push(c)
        })
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        req.on('error', reject)
      })
    }

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-whale/image.png',
      handler: (req, res) => {
        try {
          const bytes = loadImage()
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Cache-Control': 'no-store',
            'Content-Length': String(bytes.length),
          })
          res.end(bytes)
        } catch (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('whale image unavailable: ' + String((err && err.message) || err))
        }
      },
    }))

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-whale/rua.gif',
      handler: (req, res) => {
        try {
          const bytes = loadGif()
          res.writeHead(200, {
            'Content-Type': 'image/gif',
            'Cache-Control': 'no-store',
            'Content-Length': String(bytes.length),
          })
          res.end(bytes)
        } catch (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('rua gif unavailable: ' + String((err && err.message) || err))
        }
      },
    }))

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-whale/balance.json',
      handler: async (req, res) => {
        try {
          const payload = await getBalance()
          res.writeHead(200, JSON_HEADERS)
          res.end(JSON.stringify(payload))
        } catch (err) {
          res.writeHead(200, JSON_HEADERS)
          res.end(JSON.stringify({ ok: false, code: 'ERROR', error: String((err && err.message) || err).slice(0, 200) }))
        }
      },
    }))

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-whale/last-turn.json',
      handler: (req, res) => {
        // 返回最近一轮已完成的对话消耗；seq 递增供前端判断「新的一轮」
        const payload = lastTurn
          ? { ok: true, seq: lastTurnSeq, turn: lastTurn.turn, amount: lastTurn.amount, tokens: lastTurn.tokens, ts: lastTurn.ts }
          : { ok: true, seq: 0, turn: null, amount: null, tokens: null, ts: null }
        res.writeHead(200, JSON_HEADERS)
        res.end(JSON.stringify(payload))
      },
    }))

    // —— 官方平台用量（DeepSeek 平台 usage 接口，响应慢，带 5 分钟缓存）——
    // 只保留 DeepSeek 模型的桶（过滤历史数据里混入的其他模型）
    const deepseekOnly = (m) => {
      const out = {}
      for (const k of Object.keys(m || {})) {
        if (/deepseek/i.test(k)) out[k] = m[k]
      }
      return out
    }
    let officialCache = null // { key, at, models }
    let lastOfficialError = null // 最近一次官方拉取失败原因（成功时清空）
    // 平台令牌解析链：自动同步文件（油猴脚本推送）→ DEEPSEEK_PLATFORM_TOKEN 凭据 → null
    // 令牌可能是多层 JSON 包装（页面 localStorage 的 userToken 本体是 {"value":...}，端点/脚本各包一层），逐层拆开
    function normalizePlatformToken(raw) {
      let t = String(raw || '').trim()
      for (let i = 0; i < 3; i++) {
        try {
          const j = JSON.parse(t)
          if (typeof j === 'string') { t = j; continue }
          if (j && typeof j.value === 'string') { t = j.value; continue }
          if (j && typeof j.token === 'string') { t = j.token; continue }
        } catch (err) {}
        break
      }
      return t.replace(/^"/g, '').replace(/"$/g, '').replace(/^Bearer\s+/i, '').trim()
    }
    function loadStoredPlatformToken() {
      try {
        const parsed = JSON.parse(fs.readFileSync(PLATFORM_TOKEN_FILE, 'utf8'))
        if (parsed && typeof parsed.token === 'string' && parsed.token.trim()) return normalizePlatformToken(parsed.token)
      } catch (err) {}
      return null
    }
    function jwtExp(token) {
      try {
        const parts = String(token).split('.')
        if (parts.length < 2) return null
        const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
        const exp = Number(payload.exp)
        return isFinite(exp) && exp > 0 ? exp : null
      } catch (err) {
        return null
      }
    }
    async function resolvePlatformToken() {
      const stored = loadStoredPlatformToken()
      if (stored) return { token: stored, from: 'auto-sync' }
      let cred = null
      try {
        cred = await ctx.credentials.resolve('DEEPSEEK_PLATFORM_TOKEN')
      } catch (err) {}
      if (cred && cred.value) return { token: String(cred.value).replace(/^Bearer\s+/i, ''), from: 'credential' }
      return null
    }
    function normalizeOfficialSeries(data) {
      // data.data.biz_data.series[]: [{model, buckets:[{time, usage:{RESPONSE_TOKEN, PROMPT_CACHE_HIT_TOKEN, PROMPT_CACHE_MISS_TOKEN}}]}]
      let d = data
      if (d && d.data && d.data.biz_data && Array.isArray(d.data.biz_data.series)) d = d.data.biz_data
      else if (d && d.data && Array.isArray(d.data.series)) d = d.data
      const series = Array.isArray(d.series) ? d.series : null
      if (!series || series.length === 0) return null
      const models = {}
      let found = false
      for (const s of series) {
        if (!s || typeof s !== 'object') continue
        const model = String(s.model || '未知模型')
        const p = priceFor(model)
        const buckets = Array.isArray(s.buckets) ? s.buckets : []
        const b = models[model] || (models[model] = { cache: 0, miss: 0, out: 0, reasoning: 0, costCache: 0, costMiss: 0, costOut: 0 })
        for (const bk of buckets) {
          const u = bk && bk.usage
          if (!u || typeof u !== 'object') continue
          const hit = Number(u.PROMPT_CACHE_HIT_TOKEN) || 0
          const miss = Number(u.PROMPT_CACHE_MISS_TOKEN) || 0
          const out = Number(u.RESPONSE_TOKEN) || 0
          if (hit + miss + out === 0) continue
          found = true
          const pi = isPeakTime(bk.time) ? 1 : 0
          b.cache += hit
          b.miss += miss
          b.out += out
          b.costCache += (hit / 1e6) * p.hit[pi]
          b.costMiss += (miss / 1e6) * p.miss[pi]
          b.costOut += (out / 1e6) * p.out[pi]
        }
      }
      // 官方会把账号下全部模型都下发，没调用过的模型用量全 0，不进轮播展示
      for (const m of Object.keys(models)) {
        const b = models[m]
        if (b.cache + b.miss + b.out === 0) delete models[m]
      }
      return found ? models : null
    }
    // 官方拉取失败：原因写入 lastOfficialError（接口 officialError 字段）+ 打到终端日志（变化时才打）
    function failOfficial(msg) {
      if (lastOfficialError !== msg) {
        lastOfficialError = msg
        try { console.log('[dsh-whale] 官方用量拉取失败：' + msg) } catch (err) {}
      }
      return null
    }
    // 服务端直调官网控制台后台接口（对齐 zhipu 插件做法）：
    // Bearer 优先、401 回退裸令牌再试一次；15s 超时；错误带上游 msg
    async function fetchOfficialRange(startSec, endSec) {
      const key = startSec + '-' + endSec
      if (officialCache && officialCache.key === key && Date.now() - officialCache.at < 5 * 60 * 1000) {
        lastOfficialError = null
        return { models: officialCache.models, fresh: false } // 缓存期内：数据未更新
      }
      let pt
      try {
        pt = await resolvePlatformToken()
      } catch (err) {
        return failOfficial('平台凭据读取失败: ' + String((err && err.message) || err).slice(0, 80))
      }
      if (!pt) return failOfficial('未配置平台令牌（安装自动同步脚本，或在凭据服务配置 DEEPSEEK_PLATFORM_TOKEN）')
      const token = String(pt.token).replace(/^Bearer\s+/i, '')
      const expSec = jwtExp(token)
      if (expSec && expSec * 1000 < Date.now()) {
        return failOfficial('平台令牌已过期（' + new Date(expSec * 1000).toISOString() + '）：重新登录平台，自动同步脚本会推送新令牌')
      }
      const tz = -new Date().getTimezoneOffset() * 60
      // 平台 2026-09 起要求 end 对齐本地零点且落在未来（end=now 会返回 biz INVALID_PARAM）：
      // 把 end 向上取整到 start 之后的第 N 个本地零点（查询语义不变，多出的尾部当天无用量）
      const endAligned = startSec + Math.ceil(Math.max(1, endSec - startSec) / 86400) * 86400
      const url = 'https://platform.deepseek.com/api/v0/usage/by_api_key/amount?start=' + startSec + '&end=' + endAligned + '&tz=' + tz
      // 平台有 WAF：非浏览器 UA/头会被 429 Request Blocked 拦截（实测），必须带浏览器指纹
      const headers = {
        accept: 'application/json, text/plain, */*',
        'x-client-platform': 'web',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        referer: 'https://platform.deepseek.com/usage',
        origin: 'https://platform.deepseek.com',
      }
      const schemes = ['bearer', 'raw']
      let lastStatus = 0
      for (const scheme of schemes) {
        let res
        try {
          res = await fetch(url, {
            headers: { ...headers, authorization: scheme === 'bearer' ? 'Bearer ' + token : token },
            signal: AbortSignal.timeout(15000),
          })
        } catch (err) {
          const reason = err && err.name === 'TimeoutError' ? '超时(15s)' : String((err && err.message) || err)
          return failOfficial('请求失败: ' + reason)
        }
        lastStatus = res.status
        let body = null
        try { body = JSON.parse(await res.text()) } catch (err) { body = null }
        if (res.status === 401 && scheme === 'bearer') continue // 裸令牌再试一次
        if (res.status === 429) return failOfficial('HTTP 429 Request Blocked（被平台 WAF 拦截，稍后再试）')
        if (!res.ok) {
          const msg = body && typeof body === 'object' ? (body.msg || body.message || (body.error && body.error.message)) : ''
          return failOfficial('HTTP ' + res.status + (msg ? ': ' + msg : ''))
        }
        if (body === null) return failOfficial('HTTP ' + res.status + ': 非 JSON 响应')
        const models = normalizeOfficialSeries(body)
        if (!models) {
          // 平台业务层错误是 HTTP 200 + code!=200（如 40003 令牌无效）
          if (body && typeof body === 'object' && body.code !== undefined && body.code !== 200) {
            const msg = body.msg || body.message || ''
            return failOfficial('上游 code ' + body.code + ': ' + msg + (String(body.code) === '40003' ? '（令牌无效/过期：必须是网页会话令牌，sk- API Key 不行；重新登录平台后按 README 重新获取）' : ''))
          }
          return failOfficial('官方响应无用量数据（可能还没出账）')
        }
        // 官方真实金额（峰谷计费结果）：与本地价格表估算并列展示（差额=峰时多付）；失败不阻塞 token 数据
        try {
          const costUrl = url.replace('/by_api_key/amount', '/by_api_key/cost')
          const cres = await fetch(costUrl, { headers: { ...headers, authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) })
          if (cres.ok) {
            const cbody = JSON.parse(await cres.text())
            const cdata = cbody && cbody.data && cbody.data.biz_data
            const carr = cdata && Array.isArray(cdata.data) ? cdata.data : []
            const costs = {}
            for (const cur of carr) {
              if (!cur || !Array.isArray(cur.series)) continue
              for (const s of cur.series) {
                const mdl = String((s && s.model) || '')
                if (!mdl) continue
                let sum = 0
                for (const bk of (s.buckets || [])) sum += Number(bk && bk.cost) || 0
                costs[mdl] = (costs[mdl] || 0) + sum
              }
            }
            for (const m in models) {
              if (costs[m] !== undefined) models[m].officialCost = Math.round(costs[m] * 10000) / 10000
            }
          }
        } catch (err) {}
        officialCache = { key: key, at: Date.now(), models: models }
        lastOfficialError = null
        return { models: models, fresh: true }
      }
      return failOfficial('HTTP ' + lastStatus)
    }
    // 校正快照（静默期滚动校准策略）：
    // 1. 只有官方数据真正刷新（非缓存）且「官方 ≈ 本地」（官方总额 ≥ 本地的 90%，或反超）才提交校准——
    //    官方明显滞后（<90%）说明平台还没算完，沿用上一次校准基线，避免把用量校丢
    // 2. 合并显示 = 校准基线(官方) + 快照之后本地新增的量；对话进行中也照常实时叠加
    // 3. 对话结束进入静默，官方刷新追上后自动再校准一轮，基线滚动更新
    const CALIBRATE_RATIO = 0.9
    let officialCorrection = null
    // 校准对齐口径：token 数（缓存+未命中+输出）——只需与官方 token 用量一致，
    // 花费按官方价格表换算（官方侧金额本就由该表计算）
    function bucketsTokenTotal(m) {
      let t = 0
      for (const k of Object.keys(m || {})) {
        const b = m[k] || {}
        t += (Number(b.cache) || 0) + (Number(b.miss) || 0) + (Number(b.out) || 0)
      }
      return t
    }
    // 指示灯口径：全量 token（含思考），新增思考 token 也算未校准
    function bucketsFullTokenTotal(m) {
      let t = 0
      for (const k of Object.keys(m || {})) {
        const b = m[k] || {}
        t += (Number(b.cache) || 0) + (Number(b.miss) || 0) + (Number(b.out) || 0) + (Number(b.reasoning) || 0)
      }
      return t
    }
    function calibrateOk(officialMap, localMap) {
      if (!officialMap) return true // 该周期官方拉取失败：不阻塞另一周期校准
      const local = bucketsTokenTotal(localMap)
      if (local <= 0) return true // 本地没量，直接以官方为准
      return bucketsTokenTotal(officialMap) >= local * CALIBRATE_RATIO
    }
    async function refreshOfficialCorrection() {
      const now = new Date()
      const dayStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000)
      const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000)
      const nowSec = Math.floor(Date.now() / 1000)
      const rd = await fetchOfficialRange(dayStart, nowSec)
      const rm = await fetchOfficialRange(monthStart, nowSec)
      if (!rd && !rm) return officialCorrection // 官方完全不可用：沿用现有基线（纯本地/上次校准）
      if (!(rd && rd.fresh) && !(rm && rm.fresh)) return officialCorrection // 官方数据未更新：基线不动，本地增量继续叠加
      const od = rd ? rd.models : null
      const om = rm ? rm.models : null
      // 今日/本月各自独立校准：今日官方常有分钟级滞后（哨兵会拦住），不能连累本月一起放弃——
      // 否则整个校准退回纯本地账本，而本地月桶没有历史（= 今日用量），本月看起来就与今日一模一样。
      // 某周期官方没数据或明显滞后 → 沿用同周期上一轮的锚+快照；跨天/跨月则作废成空对
      // （空锚 + 空快照 = 显示整份本地账本），避免「空锚 + 非空快照」把该周期压成快照后的增量。
      const todayKey = bjDateStr()
      const monthKey = todayKey.slice(0, 7)
      const prev = officialCorrection
      const prevToday = prev && prev.dayKey === todayKey ? { off: prev.officialToday || {}, snap: prev.snapToday || {} } : { off: {}, snap: {} }
      const prevMonth = prev && prev.monthKey === monthKey ? { off: prev.officialMonth || {}, snap: prev.snapMonth || {} } : { off: {}, snap: {} }
      const tPair = od && calibrateOk(od, tokenStats.today)
        ? { off: od, snap: JSON.parse(JSON.stringify(tokenStats.today || {})) }
        : prevToday
      const mPair = om && calibrateOk(om, tokenStats.month)
        ? { off: om, snap: JSON.parse(JSON.stringify(tokenStats.month || {})) }
        : prevMonth
      officialCorrection = {
        at: Date.now(),
        dayKey: todayKey,
        monthKey: monthKey,
        officialToday: tPair.off,
        officialMonth: mPair.off,
        snapToday: tPair.snap,
        snapMonth: mPair.snap,
      }
      return officialCorrection
    }
    // 本地账本兜底（对齐 DSH 自带用量面板）：官方出账有延迟时，「官方锚 + 本地增量」可能低于
    // DSH 侧实时账本，挂件数字就会比面板少一截。这里按 模型×周期 比较 token 总数，本地账本
    // 更高时整桶换成本地账本（token 与金额同源，不拆字段混搭）。
    // 单个桶（模型级）的 token 合计；bucketsTokenTotal 是「模型→桶」整表的合计
    function bucketTokenTotal(b) {
      return (Number(b.cache) || 0) + (Number(b.miss) || 0) + (Number(b.out) || 0)
    }
    function floorByLocal(merged, localMap) {
      const out = { ...(merged || {}) }
      for (const model of Object.keys(localMap || {})) {
        const l = (localMap && localMap[model]) || {}
        const m = out[model]
        if (!m || bucketTokenTotal(m) < bucketTokenTotal(l)) {
          const fb = JSON.parse(JSON.stringify(l))
          // 官方金额（如有）仍带上：它可能比 token 出账快，用于 hero 行的峰时加价对比
          if (m && m.officialCost !== undefined) fb.officialCost = m.officialCost
          out[model] = fb
        }
      }
      return out
    }
    function mergeHybrid(officialMap, snapMap, localNow) {
      // 官方锚定历史总额，本地快照之后的新增（新对话/新模型）原样叠加，取值不为负
      const models = new Set([...Object.keys(officialMap || {}), ...Object.keys(localNow || {})])
      const cats = ['cache', 'miss', 'out', 'reasoning', 'costCache', 'costMiss', 'costOut', 'officialCost']
      const out = {}
      for (const model of models) {
        const off = officialMap && officialMap[model]
        const snap = (snapMap && snapMap[model]) || {}
        const live = (localNow && localNow[model]) || {}
        const m = { cache: 0, miss: 0, out: 0, reasoning: 0, costCache: 0, costMiss: 0, costOut: 0 }
        let has = false
        for (const c of cats) {
          const base = off ? Number(off[c]) || 0 : 0
          const delta = (Number(live[c]) || 0) - (Number(snap[c]) || 0)
          m[c] = base + Math.max(0, delta)
          if (m[c] > 0) has = true
        }
        if (has || off) out[model] = m
      }
      return out
    }

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-whale/token-stats.json',
      handler: async (req, res) => {
        ensureTokenPeriods()
        const src = normalizeUsageSource(readSizeConfig() ? readSizeConfig().usageSource : 'local')
        let source = 'local'
        let today = deepseekOnly(tokenStats.today)
        let month = deepseekOnly(tokenStats.month)
        if (src !== 'local') {
          const corr = await refreshOfficialCorrection()
          // 本月连官方锚都没有（该月官方还没出账/拉不到）时如实回退 local：本地月桶没有历史，
          // 前端据此只展示今日，避免出现「本月 = 今日」的重复视图
          if (corr && Object.keys(corr.officialMonth || {}).length) {
            today = deepseekOnly(floorByLocal(mergeHybrid(corr.officialToday, corr.snapToday, tokenStats.today), tokenStats.today))
            month = deepseekOnly(floorByLocal(mergeHybrid(corr.officialMonth, corr.snapMonth, tokenStats.month), tokenStats.month))
            source = 'hybrid'
          }
        }
        res.writeHead(200, JSON_HEADERS)
        const pt = await resolvePlatformToken()
        // calib：校准指示灯状态（仅校准模式）——gray=未配置平台令牌；yellow=已配置但有待校准的新增量；green=已按官方校准
        let calib
        if (src === 'hybrid') {
          if (!pt) {
            calib = 'gray' // 没有任何平台令牌：官方数据无法拉取
          } else {
            const localTotal = bucketsFullTokenTotal(tokenStats.today) + bucketsFullTokenTotal(tokenStats.month)
            const snapTotal = officialCorrection
              ? bucketsFullTokenTotal(officialCorrection.snapToday) + bucketsFullTokenTotal(officialCorrection.snapMonth)
              : 0
            const uncalibrated = officialCorrection ? Math.max(0, localTotal - snapTotal) : localTotal
            calib = uncalibrated > 0 ? 'yellow' : 'green'
          }
        }
        res.end(JSON.stringify({
          ok: true,
          date: tokenStats.date,
          month: tokenStats.month,
          source: source,
          today: today,
          month: month,
          calib: calib,
          tokenSet: !!pt,
          tokenExpires: pt ? jwtExp(pt.token) : null,
          // 校准模式拉取官方失败回退本地时，附带失败原因供排查
          officialError: src === 'hybrid' && source === 'local' ? (lastOfficialError || '官方数据不可用') : undefined,
        }))
      },
    }))

    // 平台令牌自动同步：官网页面上的油猴脚本把最新 userToken POST 到这里（静默期免手动抓令牌）
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-whale/platform-token',
      handler: async (req, res) => {
        // Edge/Chrome 对「https 公网页面 → 本机 127.0.0.1」强制私网预检（Private
        // Network Access）：预检应答非 2xx 或缺 PNA 头时，油猴脚本真正的 POST
        // 根本不会发出（其 fetch 静默失败），令牌永远到不了本地。
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Private-Network': 'true',
            'Access-Control-Max-Age': '86400',
          })
          res.end()
          return
        }
        const origin = String(req.headers.origin || req.headers.referer || '')
        if (origin && origin.indexOf('https://platform.deepseek.com') !== 0) {
          res.writeHead(403, JSON_HEADERS)
          res.end(JSON.stringify({ ok: false, error: 'forbidden origin' }))
          return
        }
        try {
          const raw = await readBody(req)
          let token = String(raw || '').trim()
          try {
            const j = JSON.parse(token)
            if (typeof j.token === 'string') token = j.token
            else if (typeof j === 'string') token = j
          } catch (err) {}
          token = normalizePlatformToken(token)
          if (!token || token.length < 40) {
            res.writeHead(400, JSON_HEADERS)
            res.end(JSON.stringify({ ok: false, error: 'token missing/invalid' }))
            return
          }
          fs.writeFileSync(PLATFORM_TOKEN_FILE, JSON.stringify({ token: token, updatedAt: new Date().toISOString() }), 'utf8')
          officialCache = null // 立即用新令牌重试官方拉取
          lastOfficialError = null
          res.writeHead(200, JSON_HEADERS)
          res.end(JSON.stringify({ ok: true, len: token.length }))
        } catch (err) {
          res.writeHead(400, JSON_HEADERS)
          res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err) }))
        }
      },
    }))

    // 分发油猴脚本：浏览器打开此地址即可安装（需 Tampermonkey 等脚本管理器）
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-whale/token-sync.user.js',
      handler: (req, res) => {
        try {
          const bytes = fs.readFileSync(path.join(PACKAGE_ROOT, 'assets', 'dsh-whale-token-sync.user.js'))
          res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(bytes)
        } catch (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('userscript unavailable')
        }
      },
    }))

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-whale/size.json',
      handler: async (req, res) => {
        if (req.method === 'PUT' || req.method === 'POST') {
          try {
            const body = await readBody(req)
            const parsed = JSON.parse(body)
            const scale = typeof parsed.scale === 'number' ? parsed.scale : null
            if (scale === null) {
              res.writeHead(400, JSON_HEADERS)
              res.end(JSON.stringify({ ok: false, error: 'missing scale' }))
              return
            }
            // 用量模式变化时让余额缓存失效，下次请求立即按新模式计算
            if (typeof parsed.usageMode === 'string') {
              const old = readSizeConfig()
              if (!old || normalizeUsageMode(old.usageMode) !== normalizeUsageMode(parsed.usageMode)) {
                balanceCache = null
              }
            }
            const result = writeSizeConfig(scale, parsed.sound !== false, parsed.vol, parsed.soundSet, parsed.usageMode, parsed.peakMode, parsed.bubbleOn, parsed.persistMode, parsed.valleyRemindOn, parsed.peakLockOn, parsed.turnCostOn, parsed.turnCostCloseMs, parsed.lockCarouselMs, parsed.scrollGapOn, parsed.scrollGapPx, parsed.widgetMode, parsed.usageSource, parsed.bubbleScale, parsed.fontScale)
            res.writeHead(result.ok ? 200 : 500, JSON_HEADERS)
            res.end(JSON.stringify(result))
          } catch (err) {
            res.writeHead(400, JSON_HEADERS)
            res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err) }))
          }
          return
        }
        res.writeHead(200, JSON_HEADERS)
        res.end(JSON.stringify(readSizeConfig() || {}))
      },
    }))

    function loadSound(candidates) {
      for (const p of candidates) {
        try {
          const bytes = fs.readFileSync(p)
          if (bytes && bytes.length > 0) return bytes
        } catch (err) {}
      }
      return null
    }

    function serveSound(req, res, candidates) {
      const bytes = loadSound(candidates)
      if (!bytes) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('sound unavailable')
        return
      }
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'Content-Length': String(bytes.length),
      })
      res.end(bytes)
    }

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-whale/sound/press.mp3',
      handler: (req, res) => {
        const set = SOUND_SETS[soundSetFromUrl(req.url)] || SOUND_SETS.duck
        serveSound(req, res, set.press)
      },
    }))

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-whale/sound/release.mp3',
      handler: (req, res) => {
        const set = SOUND_SETS[soundSetFromUrl(req.url)] || SOUND_SETS.duck
        serveSound(req, res, set.release)
      },
    }))

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-whale/widget.js',
      handler: (req, res) => {
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        res.end(WIDGET_JS)
      },
    }))

    disposers.push(ctx.webServer.tapIndex((html) => {
      if (html.indexOf('/dsh-whale/widget.js') !== -1) return html
      const tag = '<script defer src="/dsh-whale/widget.js"></script>'
      if (html.indexOf('</body>') !== -1) return html.replace('</body>', tag + '</body>')
      return html + tag
    }))

    ctx.effect(() => () => {
      for (const d of disposers) {
        try { d() } catch (err) {}
      }
    })
}

export { name, inject, apply }
