// ==UserScript==
// @name         DSH 小鲸鱼挂件 · 平台令牌自动同步
// @namespace    https://github.com/WIMIN144/DSH
// @version      1.0.2
// @description  读取 platform.deepseek.com 的登录令牌并推送到本机 DSH 小鲸鱼挂件，用于「今日/本月用量」官方校准。令牌只发往 127.0.0.1，不经过任何第三方。
// @author       W (dsh-whale-widget-w)
// @match        https://platform.deepseek.com/*
// @run-at       document-start
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

/*
 * 本文件由 dsh-whale-widget-w 的宿主路由 GET /dsh-whale/token-sync.user.js 分发。
 * 文中 __PORT__ 由宿主按请求 Host 动态替换，所以请始终从 http://127.0.0.1:<端口>/dsh-whale/token-sync.user.js 安装。
 *
 * 服务端契约（见 lib/index.js 的 /dsh-whale/platform-token 路由）：
 *   - POST http://127.0.0.1:<端口>/dsh-whale/platform-token
 *   - body 允许 {"token":"..."} 或裸令牌文本；服务端再解一层 JSON 包装并去掉 Bearer 前缀，去壳后长度 >= 40 才收
 *   - 只接受 POST；Origin 必须**精确等于** https://platform.deepseek.com（油猴后台直发可能不带来源头，那种放行但不回 CORS 头）
 *   - OPTIONS 预检返回 204 + Access-Control-Allow-Private-Network: true（Edge/Chrome 的私网访问限制）
 *
 * 安全：日志只打印来源 key 与长度，绝不打印令牌本体。
 *
 * 1.0.2：回到 W2 的判据。之前有一版把「必须形如 JWT（以 ey 开头）」写进了取值条件，
 *        而平台现在的会话令牌是 64 位不透明串 —— 真令牌被当成"没找到"，且失败时一声不吭，
 *        表现就是"脚本装了但灯一直是灰的"。同时补回 W2 的 5 秒轮询、来源 key 日志与 PNA 提示。
 */

(function () {
  'use strict'

  var VERSION = '1.0.2'
  var TAG = '[dsh-whale] '
  var DEFAULT_ENDPOINT = 'http://127.0.0.1:__PORT__/dsh-whale/platform-token'
  var POLL_MS = 5000
  var TIMEOUT_MS = 15000
  var MIN_LEN = 40
  var KNOWN_KEYS = ['userToken', 'user_token', 'token', 'access_token', 'accessToken', 'auth_token', 'Authorization']

  // 端点可覆盖：在 platform.deepseek.com 的控制台里设 localStorage['dshw-token-sync-endpoint']（换端口不必改脚本）
  function endpoint() {
    try {
      var v = localStorage.getItem('dshw-token-sync-endpoint')
      if (v && /^http:\/\/127\.0\.0\.1:\d+\/dsh-whale\/platform-token$/.test(v.trim())) return v.trim()
    } catch (e) {}
    return DEFAULT_ENDPOINT
  }

  // 逐层解包：JSON 字符串 / {value:...} / {token:...} / 首尾引号 / Bearer 前缀
  function unwrap(raw) {
    if (raw === null || raw === undefined) return ''
    var t = String(raw).trim()
    for (var i = 0; i < 3; i++) {
      try {
        var j = JSON.parse(t)
        if (typeof j === 'string') { t = j; continue }
        if (j && typeof j.value === 'string') { t = j.value; continue }
        if (j && typeof j.token === 'string') { t = j.token; continue }
      } catch (e) {}
      break
    }
    return t.replace(/^"/g, '').replace(/"$/g, '').replace(/^Bearer\s+/i, '').trim()
  }

  function isJwt(t) {
    return /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t)
  }

  // 已知键只要求"够长且不含空白"—— 平台令牌形态会变（JWT / 不透明串都见过），不按前缀判类型
  function looksLikeToken(t) {
    return !!t && t.length >= MIN_LEN && !/\s/.test(t)
  }

  // 先按已知键找；都不中再全量扫一遍，兜底扫描只认 JWT 形态（避免把无关长值推上去）
  function readToken() {
    try {
      for (var i = 0; i < KNOWN_KEYS.length; i++) {
        var t = unwrap(localStorage.getItem(KNOWN_KEYS[i]))
        if (looksLikeToken(t)) return { token: t, key: KNOWN_KEYS[i] }
      }
      for (var k = 0; k < localStorage.length; k++) {
        var key = localStorage.key(k)
        if (!key) continue
        var v = unwrap(localStorage.getItem(key))
        if (isJwt(v)) return { token: v, key: key + '（兜底扫描）' }
      }
    } catch (e) {
      console.warn(TAG + '读取 localStorage 失败：' + ((e && e.message) || e))
    }
    return null
  }

  function post(token, url) {
    return new Promise(function (resolve, reject) {
      var body = JSON.stringify({ token: token })
      var settle = function (ok, status, text) { resolve({ ok: ok, status: status, text: text }) }
      var gm = (typeof GM_xmlhttpRequest === 'function') ? GM_xmlhttpRequest
        : (typeof window !== 'undefined' && window.GM && typeof window.GM.xmlHttpRequest === 'function') ? window.GM.xmlHttpRequest : null
      // 油猴通道不受页面 CORS / 私网预检限制，优先用它；不可用时再退回 fetch
      if (gm) {
        try {
          gm({
            method: 'POST',
            url: url,
            data: body,
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            timeout: TIMEOUT_MS,
            onload: function (r) { settle(r.status >= 200 && r.status < 300, r.status, String(r.responseText || '').slice(0, 200)) },
            onerror: function (r) { reject(new Error('GM 请求失败（HTTP ' + ((r && r.status) || '?') + '）')) },
            ontimeout: function () { reject(new Error('GM 请求超时')) },
          })
          return
        } catch (e) {}
      }
      var ctrl = null
      var timer = null
      try {
        ctrl = new AbortController()
        timer = setTimeout(function () { try { ctrl.abort() } catch (e) {} }, TIMEOUT_MS)
      } catch (e) {}
      fetch(url, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: body,
        signal: ctrl ? ctrl.signal : undefined,
      }).then(function (res) {
        return res.text().then(function (text) { settle(res.ok, res.status, text) })
      }).catch(reject).then(function () {
        if (timer) clearTimeout(timer)
      })
    })
  }

  var lastOkToken = null
  var attempts = 0
  var loggedNotFound = false
  var loggedHint = false
  var busy = false

  function tick() {
    if (busy) return
    var found = readToken()
    if (!found) {
      if (!loggedNotFound) {
        loggedNotFound = true
        console.info(TAG + '暂未在本页 localStorage 找到平台令牌，登录后会自动重试（每 ' + (POLL_MS / 1000) + ' 秒）')
      }
      return
    }
    if (found.token === lastOkToken) return

    busy = true
    attempts++
    var url = endpoint()
    post(found.token, url).then(function (r) {
      busy = false
      loggedNotFound = false
      if (r.ok) {
        lastOkToken = found.token
        attempts = 0
        loggedHint = false
        console.info(TAG + '平台令牌已同步到本地 DSH 挂件（来源 key: ' + found.key + '，长度 ' + found.token.length + '）')
        return
      }
      lastOkToken = null
      console.warn(TAG + '令牌同步被拒：HTTP ' + r.status + ' ' + String(r.text || '').slice(0, 200))
    }).catch(function (err) {
      busy = false
      lastOkToken = null
      console.warn(TAG + '令牌同步失败（第 ' + attempts + ' 次）：' + ((err && err.message) || err))
      if (!loggedHint) {
        loggedHint = true
        console.warn(TAG + '提示：若报 Failed to fetch / NetworkError，多半是 Edge 的私网访问(PNA)权限被拒 —— 刷新本页，弹窗「想要访问此设备上的其他应用和服务」必须点【允许】；也可以先访问 ' + url + ' 确认 dsh 在跑。')
      }
    })
  }

  console.info(TAG + '平台令牌同步脚本 v' + VERSION + ' 已加载，目标 ' + endpoint())

  tick()
  setInterval(tick, POLL_MS)
  // 切回标签页时立刻补一次（登录后切回来不必等下个轮询）
  try { addEventListener('visibilitychange', function () { if (!document.hidden) tick() }) } catch (e) {}
  try { addEventListener('focus', tick) } catch (e) {}
})()
