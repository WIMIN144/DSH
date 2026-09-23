// ==UserScript==
// @name         DSH 小鲸鱼挂件 · 平台令牌自动同步
// @namespace    dsh-whale-token-sync
// @version      1.0.1
// @description  把 platform.deepseek.com 的登录会话令牌自动推送到本机 DSH 挂件端点，供「今日/本月用量」官方校准使用。令牌只发往 127.0.0.1，不经过任何第三方。
// @match        https://platform.deepseek.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

/* 全局常量说明：__PORT__ 由本地 DSH 服务在分发脚本时按请求 Host 动态注入，
 * 因此请始终从 http://127.0.0.1:<端口>/dsh-whale/token-sync.user.js 安装本脚本；
 * 直接从别处复制安装的话端口可能不对，同步会静默失败。 */
(function () {
  'use strict'
  var PORT = '__PORT__'
  var ENDPOINT = 'http://127.0.0.1:' + PORT + '/dsh-whale/platform-token'
  var PUSH_INTERVAL_MS = 10 * 60 * 1000 // 常规重推间隔：10 分钟
  var RETRY_MS = 60 * 1000              // 本地不可达/发送失败重试：1 分钟

  // 页面 localStorage 的 userToken 本体可能是 {"value":...} / {"token":...} 等多层包装，逐层解包
  function unwrap(raw) {
    var t = String(raw || '').trim()
    for (var i = 0; i < 3; i++) {
      try {
        var j = JSON.parse(t)
        if (typeof j === 'string') { t = j; continue }
        if (j && typeof j.value === 'string') { t = j.value; continue }
        if (j && typeof j.token === 'string') { t = j.token; continue }
      } catch (err) {}
      break
    }
    return t.replace(/^"/g, '').replace(/"$/g, '').replace(/^Bearer\s+/i, '').trim()
  }

  function readToken() {
    // 令牌键名兼容：userToken（现行）/ token / accessToken（旧版页面曾用）
    var keys = ['userToken', 'token', 'accessToken']
    for (var i = 0; i < keys.length; i++) {
      try {
        var v = unwrap(window.localStorage.getItem(keys[i]))
        if (v && v.length >= 40 && v.indexOf('ey') === 0) return v
      } catch (err) {}
    }
    return ''
  }

  var lastSent = ''
  function push() {
    var token = readToken()
    if (!token) return schedule(RETRY_MS)
    if (token === lastSent) return schedule(PUSH_INTERVAL_MS) // 没变化不重发
    var body = JSON.stringify({ token: token })
    var done = function (ok) {
      if (ok) {
        lastSent = token
        try { console.log('[dsh-whale] 平台令牌已同步到本地 DSH 挂件') } catch (err) {}
        schedule(PUSH_INTERVAL_MS)
      } else {
        schedule(RETRY_MS)
      }
    }
    // GM_xmlhttpRequest 不受页面 CORS/私网预检限制，优先；不可用时回退 fetch
    var gm = (typeof GM_xmlhttpRequest === 'function') ? GM_xmlhttpRequest
      : (window.GM && typeof window.GM.xmlHttpRequest === 'function') ? window.GM.xmlHttpRequest : null
    if (gm) {
      try {
        gm({
          method: 'POST',
          url: ENDPOINT,
          data: body,
          headers: { 'Content-Type': 'text/plain' },
          timeout: 10000,
          onload: function (r) { done(r.status >= 200 && r.status < 300) },
          onerror: function () { done(false) },
          ontimeout: function () { done(false) },
        })
        return
      } catch (err) {}
    }
    try {
      fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: body })
        .then(function (r) { done(r.ok) })
        .catch(function () { done(false) })
    } catch (err) { done(false) }
  }

  function schedule(ms) {
    if (push._t) clearTimeout(push._t)
    push._t = setTimeout(push, ms)
  }

  push()
  // 重新登录平台后 localStorage 里的令牌会更新：监听变化即时推送
  try {
    window.addEventListener('storage', function (e) {
      if (e && (e.key === 'userToken' || e.key === 'token' || e.key === 'accessToken')) push()
    })
  } catch (err) {}
})()
