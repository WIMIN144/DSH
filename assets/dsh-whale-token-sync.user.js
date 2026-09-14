// ==UserScript==
// @name         DSH 小鲸鱼挂件 · 平台令牌自动同步
// @namespace    https://github.com/WIMIN144/DSH
// @version      1.0.1
// @description  读取 platform.deepseek.com 的登录令牌并推送到本机 DSH 小鲸鱼挂件（127.0.0.1:3080），用于官方用量校准
// @author       W (dsh-whale-widget-w)
// @match        https://platform.deepseek.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

/*
 * 本文件由 dsh-whale-widget-w 的宿主路由 GET /dsh-whale/token-sync.user.js 分发。
 *
 * 服务端契约（见 lib/index.js 的 /dsh-whale/platform-token 路由）：
 *   - POST http://127.0.0.1:3080/dsh-whale/platform-token
 *   - Content-Type: text/plain（CORS 简单请求），body 允许 {"token":"..."} 或裸令牌文本
 *   - 服务端会再解一层 JSON 包装并去掉 Bearer 前缀，去壳后长度必须 >= 40，否则 400
 *   - 服务端只接受 Origin 以 https://platform.deepseek.com 开头的请求
 *   - 服务端对 Edge/Chrome 的私网访问预检（OPTIONS）返回 204 + Access-Control-Allow-Private-Network: true
 *
 * 安全：令牌只发往本机 127.0.0.1，不经过任何第三方；日志只打印长度，绝不打印令牌本体。
 */

(function () {
  'use strict'

  var VERSION = '1.0.1'
  var TAG = '[dsh-whale]'
  var DEFAULT_ENDPOINT = 'http://127.0.0.1:3080/dsh-whale/platform-token'
  var POLL_MS = 5000
  var TIMEOUT_MS = 15000
  var MIN_LEN = 40
  var KNOWN_KEYS = ['userToken', 'user_token', 'token', 'access_token', 'accessToken', 'auth_token', 'Authorization']

  // 端点可覆盖：localStorage['dshw-token-sync-endpoint']（换端口时不必改脚本）
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

  function looksLikeToken(t) {
    return !!t && t.length >= MIN_LEN && !/\s/.test(t)
  }

  // 依次尝试已知键；都不中则全量扫一遍，只认 JWT 形态（避免把无关长值当成令牌推上去）
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
      console.warn(TAG + ' 读取 localStorage 失败：', (e && e.message) || e)
    }
    return null
  }

  function post(token, url) {
    return new Promise(function (resolve, reject) {
      var ctrl = null
      var timer = null
      try {
        ctrl = new AbortController()
        timer = setTimeout(function () { try { ctrl.abort() } catch (e) {} }, TIMEOUT_MS)
      } catch (e) {}
      fetch(url, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit', // 服务端 ACAO 是 *，带凭据会被浏览器直接拒绝
        cache: 'no-store',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ token: token }),
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (res) {
        return res.text().then(function (text) { resolve({ status: res.status, ok: res.ok, text: text }) })
      }).catch(reject).then(function () {
        if (timer) clearTimeout(timer)
      })
    })
  }

  var lastOkToken = null   // 已成功推送的令牌（内存去重，避免每 5 秒重推）
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
        console.info(TAG + ' 暂未在本页 localStorage 找到平台令牌，登录后会自动重试')
      }
      return
    }
    if (found.token === lastOkToken) return

    busy = true
    attempts++
    post(found.token, endpoint()).then(function (r) {
      busy = false
      loggedNotFound = false
      if (r.ok) {
        lastOkToken = found.token
        attempts = 0
        loggedHint = false
        console.info(TAG + ' 平台令牌已同步到本地 DSH 挂件（来源 key: ' + found.key + '，长度 ' + found.token.length + '）')
        return
      }
      lastOkToken = null
      console.warn(TAG + ' 令牌同步被拒：HTTP ' + r.status + ' ' + String(r.text || '').slice(0, 200))
    }).catch(function (err) {
      busy = false
      lastOkToken = null
      console.warn(TAG + ' 令牌同步失败（第 ' + attempts + ' 次）：' + ((err && err.message) || err))
      if (!loggedHint) {
        loggedHint = true
        console.warn(TAG + ' 提示：若是 Failed to fetch / NetworkError，多半是 Edge 私网访问(PNA)权限被拒——' +
          '刷新 platform.deepseek.com，弹窗「想要访问此设备上的其他应用和服务」必须点【允许】；' +
          '也可先访问 ' + endpoint() + ' 确认服务在跑。')
      }
    })
  }

  console.info(TAG + ' 平台令牌同步脚本 v' + VERSION + ' 已加载，目标 ' + endpoint())

  tick()
  setInterval(tick, POLL_MS)
  // 切换回标签页时立刻补一次（登录后切回来不必等下个轮询）
  addEventListener('visibilitychange', function () { if (!document.hidden) tick() })
  addEventListener('focus', tick)
})()
