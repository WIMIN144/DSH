/**
 * dsh-zhipu-balance — client half (browser bundle, served at
 * /plugins/dsh-zhipu-balance/client.js through the `dsh.client` manifest).
 *
 * Right-edge collapsible panel for Zhipu (智谱) balances, derived from the
 * community plugin `dsh-quota-panel` (MIT) interaction model:
 *
 *   - collapsed: a slim vertical tab docked at the RIGHT edge of the window
 *     ("智谱余额" + worst-state dot). Click to expand.
 *   - expanded: a right-side drawer with per-section rows (each section title
 *     toggles its body up/down, persisted in localStorage):
 *       「资源包 · API 额度」 per resource pack (used bar, remaining/total,
 *        expiry, status; falls back to account quota windows when the pack
 *        list is unavailable)
 *       「模型用量」     calendar-month per-model tokens + spend from the expense bill (near-real-time)
 *       「Coding Plan」 5h / weekly / MCP-monthly usage windows with credit
 *        remaining / total amounts
 *     plus refresh (↻), settings (⚙) and collapse (▸) in the header.
 *
 * Data arrives over the loopback Connection RPC channel `/dsh-zhipu-balance`
 * (endpoints `specs` / `fetch-all`) owned by the host half; API keys never
 * reach the browser. Threshold judgement and coloring happen here from spec
 * hints. Settings persist to localStorage only. Styling follows the Harness
 * design tokens so the panel tracks the light/dark product theme.
 */
window.__ModuleLoader__.load({
	id: "dsh-zhipu-balance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");

		var CHANNEL = "/dsh-zhipu-balance";
		var STORAGE_KEY = "dsh-zhipu-balance:settings";
		var NS = "zhipu-balance";

		var inject = ["slots", "timer", "connection", "locale"];

		/** i18n dictionaries registered into the shell locale service. */
		var DICT = {
			zh: {
				title: "智谱余额",
				tab: "智谱余额",
				expand: "展开智谱余额面板",
				collapse: "收起",
				refresh: "刷新",
				openSettings: "设置",
				closeSettings: "关闭设置",
				sectionApi: "API 额度 · 资源包",
				sectionPacks: "资源包",
				cashBalance: "现金余额",
				cashAvailable: "可用 ¥{n}",
				cashRecharge: "充值 ¥{n}",
				cashGift: "赠送 ¥{n}",
				cashFrozen: "冻结 ¥{n}",
				cashCredit: "信用 ¥{n}",
				creditNotOpen: "信用未开通",
				packsEmpty: "账号下暂无资源包",
				packsFailed: "资源包查询失败",
				expiresOn: "{date} 到期",
				packGive: "赠送",
				packFrozen: "冻结 {n}",
				statusNotused: "未生效",
				statusExpired: "已过期",
				statusCancelled: "已作废",
				peakOn: "当前处于高峰期",
				peakOff: "当前处于非高峰期",
				peakSchedule: "高峰：北京时间工作日 14:00–18:00（积分全额抵扣）；其余时段（含周末）非高峰（5 折抵扣）",
				sectionCoding: "Coding Plan",
				sectionUsage: "模型用量 · 当月",
				apiNoData: "暂无额度条目",
				fetchFailed: "查询失败",
				loadFailed: "无法读取配置",
				noCredential: "未配置 Key",
				planLabel: "套餐",
				used: "已用 {pct}%",
				remaining: "剩 {remaining} / 共 {total}",
				remainingOnly: "剩 {remaining}",
				noWinData: "无数据",
				winRolling: "5h 窗口",
				winWeekly: "周窗口",
				winMonthly: "月度 MCP",
				resetIn: "{time}后重置",
				usageEmpty: "暂无模型用量数据",
				settingsInterval: "刷新间隔",
				settingsAutoRefresh: "自动刷新",
				followConfig: "跟随配置",
				secondsSuffix: "{n} 秒",
				minutesSuffix: "{n} 分钟",
				settingsThresholds: "预警阈值",
				warnPercent: "预警 %",
				errorPercent: "告警 %",
				sections: "显示板块",
				showApi: "API Key",
				showCoding: "Coding Plan",
				showUsage: "模型用量",
				modeLabel: "模式",
				modeFollow: "跟随配置",
				modeFollowNote: "由 settings.yaml 决定，不改动调用地址",
				apiModeNote: "调用地址 open.bigmodel.cn/api/paas/v4 · 按量计费，资源包与现金抵扣",
				codingModeNote: "调用地址 open.bigmodel.cn/api/coding/paas/v4 · 订阅额度，5h / 周窗口",
				localOnly: "设置仅保存在本浏览器",
				resetDefaults: "恢复默认",
				callMode: "调用模式",
				draggableTab: "折叠条可拖动",
				apiThresholdTitle: "API 消耗预警",
				apiThresholdType: "统计周期",
				thrPeriodMonth: "当月",
				thrPeriodToday: "当日",
				apiThresholdValue: "预警值",
				apiThresholdStop: "达到阈值同步停止调用",
				thrStopNeedValue: "请先输入预警值",
				guardNotice: "已达预警阈值，同步停止调用已生效",
				updatedAt: "更新于 {time}"
			},
			en: {
				title: "Zhipu balance",
				tab: "Zhipu",
				expand: "Expand Zhipu balance panel",
				collapse: "Collapse",
				refresh: "Refresh",
				openSettings: "Settings",
				closeSettings: "Close settings",
				sectionApi: "API quota · resource packs",
				sectionPacks: "Resource packs",
				cashBalance: "Cash balance",
				cashAvailable: "avail ¥{n}",
				cashRecharge: "topped ¥{n}",
				cashGift: "gift ¥{n}",
				cashFrozen: "frozen ¥{n}",
				cashCredit: "credit ¥{n}",
				creditNotOpen: "credit not enabled",
				packsEmpty: "No resource packs on this account",
				packsFailed: "Resource pack query failed",
				expiresOn: "expires {date}",
				packGive: "gift",
				packFrozen: "frozen {n}",
				statusNotused: "not started",
				statusExpired: "expired",
				statusCancelled: "cancelled",
				peakOn: "Peak hours now",
				peakOff: "Off-peak hours now",
				peakSchedule: "Peak: Beijing weekdays 14:00-18:00 (full deduction); all other times off-peak (50%)",
				sectionCoding: "Coding Plan",
				sectionUsage: "Model usage · this month",
				apiNoData: "No quota entries",
				fetchFailed: "Query failed",
				loadFailed: "Failed to load config",
				noCredential: "Key not configured",
				planLabel: "Plan",
				used: "Used {pct}%",
				remaining: "Left {remaining} / {total}",
				remainingOnly: "Left {remaining}",
				noWinData: "no data",
				winRolling: "5h window",
				winWeekly: "Weekly",
				winMonthly: "Monthly MCP",
				resetIn: "resets in {time}",
				usageEmpty: "No model usage data",
				settingsInterval: "Refresh interval",
				settingsAutoRefresh: "Auto refresh",
				followConfig: "Follow config",
				secondsSuffix: "{n}s",
				minutesSuffix: "{n} min",
				settingsThresholds: "Thresholds",
				warnPercent: "Warn %",
				errorPercent: "Alert %",
				sections: "Sections",
				showApi: "API Key",
				showCoding: "Coding Plan",
				showUsage: "Model usage",
				modeLabel: "Mode",
				modeFollow: "Follow config",
				modeFollowNote: "Decided by settings.yaml — endpoint untouched",
				apiModeNote: "Endpoint open.bigmodel.cn/api/paas/v4 · pay-as-you-go, packs & cash",
				codingModeNote: "Endpoint open.bigmodel.cn/api/coding/paas/v4 · subscription quota (5h / weekly)",
				localOnly: "Stored in this browser only",
				resetDefaults: "Reset defaults",
				callMode: "Call mode",
				draggableTab: "Draggable collapsed tab",
				apiThresholdTitle: "API spend alert",
				apiThresholdType: "Period",
				thrPeriodMonth: "This month",
				thrPeriodToday: "Today",
				apiThresholdValue: "Alert at",
				apiThresholdStop: "Stop calls at threshold",
				thrStopNeedValue: "Enter an alert value first",
				guardNotice: "Threshold reached — call stop is active",
				updatedAt: "Updated {time}"
			}
		};

		// The shell overlay layer renders at z-index 20; body-mounted third-party
		// panels commonly sit at 1000+. Lift the layer so the drawer stays visible
		// (same approach as dsh-quota-panel).
		var OVERLAY_LIFT_CSS = '[class*="overlayLayer"]{z-index:1150 !important;}';

		var CSS = [
			'#dsh-zhipu-balance{font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif);font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#1b1b1c)}',
			'#dzb-tab{position:fixed;right:0;top:42%;transform:translateY(-50%);z-index:900;display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 7px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-right:none;border-radius:10px 0 0 10px;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:var(--dsw-shadow-lv2,0 4px 12px rgba(15,17,21,.08));cursor:pointer;font:inherit;letter-spacing:.14em;writing-mode:vertical-rl;color:var(--dsw-alias-label-primary,#1b1b1c);transition:background-color 120ms ease,padding-right 120ms ease;touch-action:none}',
			'#dzb-tab:hover{background:var(--dsw-alias-bg-overlay,#ebeef2);padding-right:10px}',
			'#dzb-tab .dzb-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-static-neutral-bluish-400,#adb2b8);writing-mode:horizontal-tb}',
			'#dzb-tab .dzb-dot.state-ok{background:var(--dsw-static-green-500,#22c55e)}',
			'#dzb-tab .dzb-dot.state-warn{background:var(--dsw-static-amber-500,#f59e0b)}',
			'#dzb-tab .dzb-dot.state-error{background:var(--dsw-static-red-500,#ef4444)}',
			'#dzb-tab.dzb-draggable{cursor:grab}',
			'#dzb-tab.dzb-dragging{cursor:grabbing;user-select:none;transition:none}',
			'#dzb-panel{position:fixed;right:0;top:0;bottom:0;width:340px;max-width:92vw;z-index:900;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#fff);border-left:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));box-shadow:var(--dsw-shadow-lv3,-8px 0 24px rgba(15,17,21,.08));animation:dzb-slide-in 180ms ease}',
			'#dzb-panel.dzb-white-bg{background:#ffffff}',
			'@keyframes dzb-slide-in{from{transform:translateX(24px);opacity:.4}to{transform:translateX(0);opacity:1}}',
			'#dzb-panel .dzb-header{flex:none;display:flex;align-items:center;gap:4px;padding:12px 12px 12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06))}',
			'#dzb-panel .dzb-title{flex:1;font-weight:600;font-size:14px}',
			'#dzb-panel .dzb-icon{flex:none;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#61666b);cursor:pointer;font-size:14px;line-height:1;transition:background-color 120ms ease,color 120ms ease}',
			'#dzb-panel .dzb-icon:hover{background:var(--dsw-alias-bg-overlay,#ebeef2);color:var(--dsw-alias-label-primary,#1b1b1c)}',
			'#dzb-panel .dzb-icon.is-active{background:var(--dsw-alias-bg-overlay,#ebeef2);color:var(--dsw-alias-label-primary,#1b1b1c)}',
			'#dzb-panel .dzb-icon.is-loading{pointer-events:none;opacity:.55}',
			'#dzb-panel .dzb-body{flex:1;overflow-y:auto;padding:8px 16px 16px}',
			'#dzb-panel .dzb-section{padding:10px 0 4px}',
			'#dzb-panel .dzb-section-title{display:flex;align-items:baseline;gap:6px;font-weight:600;font-size:12px;color:var(--dsw-alias-label-secondary,#61666b);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}',
			'#dzb-panel .dzb-section-title.dzb-toggle{cursor:pointer;user-select:none;border-radius:6px;padding:2px 4px;margin-left:-4px;margin-right:-4px;transition:background-color 120ms ease}',
			'#dzb-panel .dzb-section-title.dzb-toggle:hover{background:var(--dsw-alias-bg-overlay,#ebeef2)}',
			'#dzb-panel .dzb-chevron{flex:none;font-size:10px;line-height:1;transform:translateY(-1px)}',
			'#dzb-panel .dzb-peak{font-size:11px;font-weight:400;margin-left:10px;letter-spacing:normal;writing-mode:horizontal-tb}',
			'#dzb-panel .dzb-peak.peak{color:var(--dsw-static-amber-600,#d97706)}',
			'#dzb-panel .dzb-peak.off{color:var(--dsw-static-green-600,#16a34a)}',
			'#dzb-panel .dzb-plan{font-weight:400;font-size:11px;color:var(--dsw-alias-label-tertiary,#8f959c);letter-spacing:0;text-transform:none}',
			'#dzb-panel .dzb-row{padding:7px 0}',
			'#dzb-panel .dzb-row-head{display:flex;align-items:baseline;gap:8px}',
			'#dzb-panel .dzb-row-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'#dzb-panel .dzb-row-value{flex:none;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#61666b)}',
			'#dzb-panel .dzb-row-value.state-warn{color:var(--dsw-static-amber-500,#f59e0b)}',
			'#dzb-panel .dzb-row-value.state-error{color:var(--dsw-static-red-500,#ef4444)}',
			'#dzb-panel .dzb-bar{margin-top:5px;height:4px;border-radius:2px;background:var(--dsw-alias-bg-overlay,#ebeef2);overflow:hidden}',
			'#dzb-panel .dzb-bar-fill{height:100%;border-radius:2px;background:var(--dsw-static-neutral-bluish-400,#adb2b8)}',
			'#dzb-panel .dzb-bar-fill.state-ok{background:var(--dsw-static-green-500,#22c55e)}',
			'#dzb-panel .dzb-bar-fill.state-warn{background:var(--dsw-static-amber-500,#f59e0b)}',
			'#dzb-panel .dzb-bar-fill.state-error{background:var(--dsw-static-red-500,#ef4444)}',
			'#dzb-panel .dzb-sub{margin-top:4px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8f959c)}',
			'#dzb-panel .dzb-error{padding:8px 10px;border:1px solid var(--dsw-static-red-500,#ef4444);border-radius:8px;color:var(--dsw-static-red-500,#ef4444);font-size:12px;margin:6px 0;word-break:break-all}',
			'#dzb-panel .dzb-hint{padding:8px 0;font-size:12px;color:var(--dsw-alias-label-tertiary,#8f959c)}',
			'#dzb-panel .dzb-divider{height:1px;background:var(--dsw-alias-border-l1,rgba(0,0,0,.06));margin:6px 0}',
			'#dzb-panel .dzb-footer{flex:none;padding:10px 16px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06));font-size:11px;color:var(--dsw-alias-label-tertiary,#8f959c)}',
			'#dzb-panel .dzb-settings{padding:4px 0 12px}',
			'#dzb-panel .dzb-setting-title{font-weight:600;font-size:12px;color:var(--dsw-alias-label-secondary,#61666b);margin:12px 0 6px}',
			'#dzb-panel .dzb-setting-row{display:flex;align-items:center;gap:8px;padding:4px 0}',
			'#dzb-panel .dzb-setting-name{flex:1;font-size:12px}',
			'#dzb-panel .dzb-setting-note{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#8f959c);padding:0 0 2px 2px;word-break:break-all}',
			'#dzb-panel select,#dzb-panel input[type=number],#dzb-panel input[type=text]{font:inherit;font-size:12px;padding:4px 6px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:6px;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#1b1b1c);width:110px}',
			'#dzb-panel input[type=checkbox]{accent-color:var(--dsw-alias-label-primary,#1b1b1c)}',
			'#dzb-panel .dzb-setting-reset{font:inherit;font-size:12px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#61666b);cursor:pointer}',
			'#dzb-panel .dzb-setting-reset:hover{background:var(--dsw-alias-bg-overlay,#ebeef2)}'
		].join("\n");

		/** Read persisted settings; always returns a fresh object. */
		function readSettings() {
			// Call mode drives which section shows AND which provider endpoint
			// dsh calls (synced host-side). "follow" leaves settings.yaml alone.
			// apiThreshold* — manual API-mode consumption alert (tokens this month or
			// cumulative ¥ spend); stop=true parks the provider baseURL on a
			// loopback refuse port once the threshold is crossed.
			var base = { collapsed: {}, refreshMs: null, warnPercent: null, errorPercent: null, whiteBackground: false, showModelUsage: true, callMode: "follow", draggableTab: false, tabTop: null, apiThresholdPeriod: "month", apiThresholdUnit: "token", apiThresholdValue: null, apiThresholdStop: false };
			try {
				var raw = globalThis.localStorage.getItem(STORAGE_KEY);
				if (!raw) return base;
				var parsed = JSON.parse(raw);
				if (!parsed || typeof parsed !== "object") return base;
				return {
					collapsed: parsed.collapsed && typeof parsed.collapsed === "object" ? parsed.collapsed : {},
					refreshMs: typeof parsed.refreshMs === "number" ? parsed.refreshMs : null,
					warnPercent: typeof parsed.warnPercent === "number" ? parsed.warnPercent : null,
					errorPercent: typeof parsed.errorPercent === "number" ? parsed.errorPercent : null,
					whiteBackground: typeof parsed.whiteBackground === "boolean" ? parsed.whiteBackground : false,
					showModelUsage: typeof parsed.showModelUsage === "boolean" ? parsed.showModelUsage : true,
					callMode: parsed.callMode === "api" || parsed.callMode === "coding" ? parsed.callMode : "follow",
					draggableTab: typeof parsed.draggableTab === "boolean" ? parsed.draggableTab : false,
					tabTop: typeof parsed.tabTop === "number" ? parsed.tabTop : null,
					apiThresholdPeriod: parsed.apiThresholdPeriod === "today" ? "today" : "month",
					apiThresholdUnit: parsed.apiThresholdUnit === "cny" ? "cny" : "token",
					apiThresholdValue: typeof parsed.apiThresholdValue === "number" && parsed.apiThresholdValue > 0 ? parsed.apiThresholdValue : null,
					apiThresholdStop: typeof parsed.apiThresholdStop === "boolean" ? parsed.apiThresholdStop : false
				};
			} catch (err) {
				return base;
			}
		}

		function writeSettings(settings) {
			try {
				globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
			} catch (err) { /* storage unavailable — settings stay in memory */ }
		}

		/** Status bucket from a used-percent value and thresholds. */
		function statusOf(percent, warn, error) {
			if (percent === null || percent === undefined || !isFinite(percent)) return "muted";
			if (percent >= error) return "error";
			if (percent >= warn) return "warn";
			return "ok";
		}

		/** GLM Coding Plan 峰谷时段：高峰 = 北京时间工作日 14:00–18:00（全额抵扣），
		 *  其余（工作日其他时段与周末全天）= 非高峰（基础积分 5 折）。 */
		function codingPeakState(date) {
			date = date || new Date();
			var parts = new Intl.DateTimeFormat("en-GB", {
				timeZone: "Asia/Shanghai", hour12: false, hour: "2-digit", minute: "2-digit"
			}).formatToParts(date);
			var hour = 0, minute = 0;
			for (var i = 0; i < parts.length; i++) {
				if (parts[i].type === "hour") hour = Number(parts[i].value);
				else if (parts[i].type === "minute") minute = Number(parts[i].value);
			}
			var dayName = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short" }).format(date);
			var day = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[dayName];
			var weekend = day === 0 || day === 6;
			var minutes = hour * 60 + minute;
			return { isPeak: !weekend && minutes >= 14 * 60 && minutes < 18 * 60, weekend: weekend };
		}

		/** Thousands separators. */
		function fmtNum(value) {
			var n = Number(value);
			if (!isFinite(n)) return "?";
			return n.toLocaleString("en-US");
		}

		/** Compact token formatting (万 / 亿). */
		function fmtTokens(value) {
			var n = Number(value);
			if (!isFinite(n)) return "?";
			if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + "亿";
			if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(1) + "万";
			return String(n);
		}

		/** Human countdown until an ISO reset time. */
		function fmtCountdown(iso) {
			if (!iso) return null;
			var delta = new Date(iso).getTime() - Date.now();
			if (!isFinite(delta) || delta <= 0) return null;
			var minutes = Math.round(delta / 60000);
			if (minutes < 1) return "<1 分钟";
			if (minutes < 60) return minutes + " 分钟";
			var hours = Math.floor(minutes / 60);
			var rest = minutes % 60;
			if (hours < 48) return rest > 0 ? hours + " 小时 " + rest + " 分" : hours + " 小时";
			return Math.round(hours / 24) + " 天";
		}

		/** One quota/resource-pack entry row inside the API section. */
		function EntryRow(t, entry, warn, error) {
			var pct = entry.percent;
			var state = statusOf(pct, warn, error);
			var head = [
				React.createElement("span", { key: "label", className: "dzb-row-label", title: entry.hover || entry.label }, entry.label)
			];
			if (pct !== null && pct !== undefined) {
				head.push(React.createElement("span", { key: "value", className: "dzb-row-value state-" + state }, t("used", { pct: String(pct) })));
			} else {
				head.push(React.createElement("span", { key: "value", className: "dzb-row-value" }, "—"));
			}
			var children = [React.createElement("div", { key: "head", className: "dzb-row-head" }, head)];
			if (pct !== null && pct !== undefined) {
				children.push(React.createElement("div", { key: "bar", className: "dzb-bar" },
					React.createElement("div", { className: "dzb-bar-fill state-" + state, style: { width: Math.min(100, Math.max(0, pct)) + "%" } })));
			}
			var subBits = [];
			if (entry.remainingText !== null && entry.remainingText !== undefined) {
				subBits.push(entry.totalText !== null && entry.totalText !== undefined
					? t("remaining", { remaining: fmtNum(entry.remainingText), total: fmtNum(entry.totalText) })
					: t("remainingOnly", { remaining: fmtNum(entry.remainingText) }));
			}
			var countdown = fmtCountdown(entry.resetsAt);
			if (countdown) subBits.push(t("resetIn", { time: countdown }));
			if (subBits.length > 0) children.push(React.createElement("div", { key: "sub", className: "dzb-sub" }, subBits.join(" · ")));
			return React.createElement("div", { key: entry.label, className: "dzb-row" }, children);
		}

		/** Unit-aware pack amount: tokens compact, per-count with 次. */
		function fmtPackAmount(value, unit) {
			var n = Number(value);
			if (!isFinite(n)) return "?";
			if (unit === "times") return fmtNum(n) + " 次";
			if (unit === "tokens") return fmtTokens(n);
			return fmtNum(n);
		}

		/** Two-decimal currency formatting. */
		function fmtYuan(value) {
			var n = Number(value);
			if (!isFinite(n)) return "?";
			return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		}

		/** The cash-balance row (console 财务总览 mirror). */
		function CashRow(t, cash) {
			var head = [
				React.createElement("span", { key: "label", className: "dzb-row-label" }, t("cashBalance")),
				React.createElement("span", { key: "value", className: "dzb-row-value" }, "¥" + fmtYuan(cash.balance))
			];
			var children = [React.createElement("div", { key: "head", className: "dzb-row-head" }, head)];
			var subBits = [];
			if (cash.available !== null && cash.available !== undefined) subBits.push(t("cashAvailable", { n: fmtYuan(cash.available) }));
			if (cash.recharge !== null && cash.recharge !== undefined) subBits.push(t("cashRecharge", { n: fmtYuan(cash.recharge) }));
			if (cash.gift > 0) subBits.push(t("cashGift", { n: fmtYuan(cash.gift) }));
			if (cash.frozen > 0) subBits.push(t("cashFrozen", { n: fmtYuan(cash.frozen) }));
			if (cash.creditStatus === "NOT_OPEN" || cash.creditStatus === "CLOSED") subBits.push(t("creditNotOpen"));
			else if (cash.credit !== null && cash.credit !== undefined) subBits.push(t("cashCredit", { n: fmtYuan(cash.credit) }));
			if (subBits.length > 0) children.push(React.createElement("div", { key: "sub", className: "dzb-sub" }, subBits.join(" · ")));
			return React.createElement("div", { key: "cash", className: "dzb-row" }, children);
		}

		/** Localized status suffix for a non-effective pack. */
		function packStatusText(t, status) {
			if (status === "NOTUSED") return t("statusNotused");
			if (status === "EXPIRED") return t("statusExpired");
			if (status === "CANCELLED") return t("statusCancelled");
			return null;
		}

		/** One resource-pack row: name, used bar, balance/expiry sub-line. */
		function PackRow(t, pack, warn, error) {
			var pct = pack.percent;
			var state = statusOf(pct, warn, error);
			var hoverBits = [];
			if (pack.scene) hoverBits.push(pack.scene);
			if (pack.models) hoverBits.push(pack.models);
			var head = [
				React.createElement("span", { key: "label", className: "dzb-row-label", title: hoverBits.join("\n") || pack.name }, pack.name),
				React.createElement("span", { key: "value", className: "dzb-row-value state-" + state },
					pct === null || pct === undefined ? "—" : t("used", { pct: String(pct) }))
			];
			var children = [React.createElement("div", { key: "head", className: "dzb-row-head" }, head)];
			if (pct !== null && pct !== undefined) {
				children.push(React.createElement("div", { key: "bar", className: "dzb-bar" },
					React.createElement("div", { className: "dzb-bar-fill state-" + state, style: { width: Math.min(100, Math.max(0, pct)) + "%" } })));
			}
			var subBits = [];
			if (pack.available !== null && pack.available !== undefined && pack.total !== null && pack.total !== undefined) {
				subBits.push("剩 " + fmtPackAmount(pack.available, pack.unit) + " / " + fmtPackAmount(pack.total, pack.unit));
			} else if (pack.available !== null && pack.available !== undefined) {
				subBits.push("剩 " + fmtPackAmount(pack.available, pack.unit));
			}
			if (pack.frozen && pack.frozen > 0) subBits.push(t("packFrozen", { n: fmtPackAmount(pack.frozen, pack.unit) }));
			if (pack.expiresAt) {
				var expiryText = t("expiresOn", { date: new Date(pack.expiresAt).toLocaleDateString() });
				var countdown = fmtCountdown(pack.expiresAt);
				subBits.push(countdown && countdown.indexOf("天") >= 0 ? expiryText + "（" + countdown + "）" : expiryText);
			}
			var statusText = packStatusText(t, pack.status);
			if (statusText) subBits.push(statusText);
			else if (pack.type === "give") subBits.push(t("packGive"));
			if (subBits.length > 0) children.push(React.createElement("div", { key: "sub", className: "dzb-sub" }, subBits.join(" · ")));
			return React.createElement("div", { key: pack.name + String(pack.expiresAt ?? ""), className: "dzb-row" }, children);
		}

		/** One coding-plan window row (5h / weekly / monthly MCP). */
		function WindowRow(t, label, win, warn, error) {
			var pct = win ? win.percent : null;
			var state = statusOf(pct, warn, error);
			var head = [
				React.createElement("span", { key: "label", className: "dzb-row-label" }, label),
				React.createElement("span", { key: "value", className: "dzb-row-value state-" + state },
					pct === null || pct === undefined ? t("noWinData") : t("used", { pct: String(pct) }))
			];
			var children = [React.createElement("div", { key: "head", className: "dzb-row-head" }, head)];
			if (pct !== null && pct !== undefined) {
				children.push(React.createElement("div", { key: "bar", className: "dzb-bar" },
					React.createElement("div", { className: "dzb-bar-fill state-" + state, style: { width: Math.min(100, Math.max(0, pct)) + "%" } })));
			}
			var subBits = [];
			if (win && win.remaining !== null && win.remaining !== undefined) {
				subBits.push(win.total !== null && win.total !== undefined
					? t("remaining", { remaining: fmtNum(win.remaining), total: fmtNum(win.total) })
					: t("remainingOnly", { remaining: fmtNum(win.remaining) }));
			}
			var countdown = win ? fmtCountdown(win.resetsAt) : null;
			if (countdown) subBits.push(t("resetIn", { time: countdown }));
			if (subBits.length > 0) children.push(React.createElement("div", { key: "sub", className: "dzb-sub" }, subBits.join(" · ")));
			return React.createElement("div", { key: label, className: "dzb-row" }, children);
		}

		/**
		 * Section header with an optional plan badge. When `fold` is provided
		 * ({ key, collapsed, onToggle }) the title toggles its section body.
		 */
		function SectionTitle(label, plan, fold) {
			var children = [];
			if (fold) {
				children.push(React.createElement("span", { key: "chev", className: "dzb-chevron" }, fold.collapsed ? "▸" : "▾"));
			}
			children.push(React.createElement("span", { key: "t" }, label));
			if (plan) {
				var shown = plan.length > 40 ? plan.slice(0, 40) + "…" : plan;
				children.push(React.createElement("span", { key: "p", className: "dzb-plan" }, shown));
			}
			if (fold) {
				return React.createElement("div", {
					className: "dzb-section-title dzb-toggle",
					role: "button", tabIndex: 0, "aria-expanded": fold.collapsed ? "false" : "true",
					onClick: fold.onToggle,
					onKeyDown: function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fold.onToggle(); } }
				}, children);
			}
			return React.createElement("div", { className: "dzb-section-title" }, children);
		}

		/** The settings drawer body. */
		function SettingsPanel(props) {
			var t = props.t;
			var settings = props.settings;
			var onChange = props.onChange;
			var REFRESH_CHOICES = ["", "15000", "30000", "60000", "120000", "300000"];
			var intervalOptions = [React.createElement("option", { key: "follow", value: "" }, t("followConfig"))];
			for (var i = 1; i < REFRESH_CHOICES.length; i++) {
				var ms = Number(REFRESH_CHOICES[i]);
				var label = ms < 60000 ? t("secondsSuffix", { n: String(ms / 1000) }) : t("minutesSuffix", { n: String(ms / 60000) });
				intervalOptions.push(React.createElement("option", { key: String(ms), value: String(ms) }, label));
			}
			// 调用模式：下拉选择（同“自动刷新”样式）。api/coding 会同步切换
			// 宿主端 provider 的调用地址（互斥计费面）；follow 不改动配置。
			var mode = settings.callMode || "follow";
			var modeChoices = [
				{ value: "follow", label: t("modeFollow"), note: t("modeFollowNote") },
				{ value: "api", label: t("showApi"), note: t("apiModeNote") },
				{ value: "coding", label: t("showCoding"), note: t("codingModeNote") }
			];
			var activeChoice = modeChoices.filter(function (c) { return c.value === mode; })[0] || modeChoices[0];
			var callModeBlock = [
				React.createElement("div", { key: "mode-row", className: "dzb-setting-row" },
					React.createElement("span", { className: "dzb-setting-name" }, t("modeLabel")),
					React.createElement("select", {
						value: mode,
						onChange: function (e) {
							// The Panel-level effect syncs mode + threshold guard
							// to the host in one write; no direct RPC here.
							onChange(Object.assign({}, settings, { callMode: e.target.value }));
						}
					}, modeChoices.map(function (c) {
						return React.createElement("option", { key: c.value, value: c.value }, c.label);
					}))),
				React.createElement("div", { key: "mode-note", className: "dzb-setting-note" }, activeChoice.note)
			];
			
			// 添加显示相关的选项
			var displayOptions = [
				React.createElement("div", { key: "white-bg", className: "dzb-setting-row" },
					React.createElement("span", { className: "dzb-setting-name" }, "白色背景"),
					React.createElement("input", {
						type: "checkbox",
						checked: settings.whiteBackground,
						onChange: function (e) {
							onChange(Object.assign({}, settings, { whiteBackground: e.target.checked }));
						}
					})),
				React.createElement("div", { key: "show-usage", className: "dzb-setting-row" },
					React.createElement("span", { className: "dzb-setting-name" }, "显示模型用量"),
					React.createElement("input", {
						type: "checkbox",
						checked: settings.showModelUsage,
						onChange: function (e) {
							onChange(Object.assign({}, settings, { showModelUsage: e.target.checked }));
						}
					})),
				React.createElement("div", { key: "draggable-tab", className: "dzb-setting-row" },
					React.createElement("span", { className: "dzb-setting-name" }, t("draggableTab")),
					React.createElement("input", {
						type: "checkbox",
						checked: settings.draggableTab,
						onChange: function (e) {
							onChange(Object.assign({}, settings, { draggableTab: e.target.checked, tabTop: e.target.checked ? settings.tabTop : null }));
						}
					}))
			];
			return React.createElement("div", { className: "dzb-settings" },
				React.createElement("div", { className: "dzb-setting-title" }, t("callMode")),
				callModeBlock,
				React.createElement("div", { className: "dzb-setting-title" }, t("settingsInterval")),
				React.createElement("div", { className: "dzb-setting-row" },
					React.createElement("span", { className: "dzb-setting-name" }, t("settingsAutoRefresh")),
					React.createElement("select", {
						value: settings.refreshMs === null ? "" : String(settings.refreshMs),
						onChange: function (e) {
							onChange(Object.assign({}, settings, { refreshMs: e.target.value === "" ? null : Number(e.target.value) }));
						}
					}, intervalOptions)),
				React.createElement("div", { className: "dzb-setting-title" }, t("sections")),
				displayOptions,

				React.createElement("div", { className: "dzb-setting-row", style: { justifyContent: "space-between", marginTop: "8px" } },
					React.createElement("span", { className: "dzb-setting-name", style: { color: "var(--dsw-alias-label-tertiary,#8f959c)" } }, t("localOnly")),
					React.createElement("button", {
						className: "dzb-setting-reset", type: "button",
						onClick: function () { onChange({ collapsed: {}, refreshMs: null, warnPercent: null, errorPercent: null, whiteBackground: false, showModelUsage: true, callMode: "follow", draggableTab: false, tabTop: null, apiThresholdPeriod: "month", apiThresholdUnit: "token", apiThresholdValue: null, apiThresholdStop: false }); }
					}, t("resetDefaults"))));
		}

		function apply(ctx) {
			ctx.effect(function () {
				var tag = document.createElement("style");
				tag.dataset.plugin = "dsh-zhipu-balance";
				tag.textContent = CSS;
				document.head.append(tag);
				var lift = document.createElement("style");
				lift.dataset.plugin = "dsh-zhipu-balance";
				lift.dataset.role = "overlay-lift";
				lift.textContent = OVERLAY_LIFT_CSS;
				document.head.append(lift);
				return function () { tag.remove(); lift.remove(); };
			}, "dsh-zhipu-balance: styles");

			function Panel(props) {
				var t = props.t;
				var specsState = React.useState(null);
				var specs = specsState[0], setSpecs = specsState[1];
				var dataState = React.useState({});
				var dataById = dataState[0], setDataById = dataState[1];
				var errState = React.useState(null);
				var loadError = errState[0], setLoadError = errState[1];
				var atState = React.useState(null);
				var fetchedAt = atState[0], setFetchedAt = atState[1];
				var expState = React.useState(false);
				var expanded = expState[0], setExpanded = expState[1];
				var setOpen = React.useState(false);
				var settingsOpen = setOpen[0], setSettingsOpen = setOpen[1];
				var refreshingState = React.useState(false);
				var refreshing = refreshingState[0], setRefreshing = refreshingState[1];
				var settingsState = React.useState(readSettings);
				var settings = settingsState[0];
				var updateSettings = function (next) {
					writeSettings(next);
					settingsState[1](next);
				};
				// 折叠条拖动：live 位置存 ref（供 pointerup 读取最新值），
				// 渲染用 state；拖动超过 4px 才算拖动（区分点击展开）。
				var dragState = React.useRef({ active: false, startY: 0, origTop: 0, top: 0, moved: false, suppressClick: false });
				var dragTopState = React.useState(null);
				var dragTopLive = dragTopState[0], setDragTopLive = dragTopState[1];
				var warn = settings.warnPercent !== null && specs && specs.warnPercent !== undefined ? settings.warnPercent : (specs ? specs.warnPercent : 70);
				var error = settings.errorPercent !== null && specs && specs.errorPercent !== undefined ? settings.errorPercent : (specs ? specs.errorPercent : 90);
				if (settings.warnPercent !== null) warn = settings.warnPercent;
				if (settings.errorPercent !== null) error = settings.errorPercent;

				var call = function (endpoint, payload) {
					return ctx.connection.rpc.call(CHANNEL, endpoint, payload);
				};

				var loadSpecs = function () {
					return call("specs", null).then(function (result) {
						if (result && result.ok === true && result.value && Array.isArray(result.value.rows)) {
							setSpecs(result.value);
						} else {
							setLoadError(result && result.error ? result.error.message : t("loadFailed"));
						}
					}).catch(function (e) {
						setLoadError(String((e && e.message) || e));
					});
				};

				var load = function () {
					return call("fetch-all", null).then(function (result) {
						if (result && result.ok === true && result.value && Array.isArray(result.value.rows)) {
							var map = {};
							for (var i = 0; i < result.value.rows.length; i++) map[result.value.rows[i].id] = result.value.rows[i];
							setDataById(map);
							setFetchedAt(result.value.fetchedAt || Date.now());
							setLoadError(null);
						} else {
							setLoadError(result && result.error ? result.error.message : t("fetchFailed"));
						}
					}).catch(function (e) {
						setLoadError(String((e && e.message) || e));
					});
				};

				var refreshAll = function () {
					if (refreshing) return;
					setRefreshing(true);
					(specs ? Promise.resolve() : loadSpecs()).then(load).then(function () {
						setRefreshing(false);
					}, function () { setRefreshing(false); });
				};

				React.useEffect(function () { loadSpecs().then(load); }, []);

				var effectiveMs = settings.refreshMs !== null && settings.refreshMs !== undefined
					? settings.refreshMs
					: (specs ? specs.refreshMs : 60000);

				React.useEffect(function () {
					return ctx.interval(function () {
						if (!document.hidden) load();
					}, effectiveMs);
				}, [effectiveMs]);

				React.useEffect(function () {
					var onVisible = function () { if (!document.hidden) load(); };
					document.addEventListener("visibilitychange", onVisible);
					return function () { document.removeEventListener("visibilitychange", onVisible); };
				}, []);

				// ── derive view state ────────────────────────────────────
				var apiData = dataById.api;
				var codingData = dataById.coding;
				var apiView = apiData && apiData.view ? apiData.view : null;
				var apiError = apiData && apiData.error ? apiData.error : null;
				var codingView = codingData && codingData.view ? codingData.view : null;
				var codingError = codingData && codingData.error ? codingData.error : null;

				// Call mode drives section visibility: api mode → API 额度 only,
				// coding mode → Coding Plan only, follow → both.
				var callMode = settings.callMode || "follow";
				var apiVisible = callMode !== "coding";
				var codingVisible = callMode !== "api";

				// API 消耗预警（仅 API Key 模式）：数据取自账单（实时出账）。
				// 周期（当月/当日）× 单位（token/¥）两个维度组合出四种口径。
				var bill = apiView && !apiError ? apiView.bill : null;
				var apiThresholdConsumed = null;
				var thrPeriod = settings.apiThresholdPeriod === "today" ? "today" : "month";
				var thrUnit = settings.apiThresholdUnit === "cny" ? "cny" : "token";
				var thrSource = thrPeriod === "today"
					? (bill && bill.today ? { models: bill.today.models, spend: bill.today.daySpend } : null)
					: (bill && Array.isArray(bill.models) ? { models: bill.models, spend: bill.monthSpend } : null);
				if (callMode === "api" && settings.apiThresholdValue !== null && settings.apiThresholdValue > 0 && thrSource && thrSource.models && thrSource.models.length > 0) {
					if (thrUnit === "cny") {
						if (typeof thrSource.spend === "number") apiThresholdConsumed = thrSource.spend;
					} else {
						var consumedTokens = 0;
						for (var di = 0; di < thrSource.models.length; di++) consumedTokens += thrSource.models[di].tokens;
						apiThresholdConsumed = consumedTokens;
					}
				}
				var apiThresholdExceeded = apiThresholdConsumed !== null && apiThresholdConsumed >= settings.apiThresholdValue;
				// 阈值守卫：模式或守卫状态变化时，一次性同步到宿主端。
				// guard=true 时宿主端把 baseURL 指向本机拒绝端口 → 调用立即失败、不计费；
				// guard=false（或解除阈值/切模式）时按当前模式恢复正常地址。
				var guardActive = callMode === "api" && apiThresholdExceeded && settings.apiThresholdStop === true;

				// 状态点以"能否调用"为准：绿=可调用（余额>0/数据正常），
				// 黄=已勾选停止调用且达到手动预警（守卫同步生效中），
				// 红=余额耗尽，灰=数据未知。不勾选停止调用时永远不亮黄。
				var worst;
				if (callMode === "api") {
					if (apiView && apiView.cash && typeof apiView.cash.balance === "number") {
						worst = apiView.cash.balance > 0 ? "ok" : "error";
					} else if (apiView && !apiError) {
						worst = "ok";
					} else {
						worst = "muted";
					}
					if (apiThresholdExceeded && settings.apiThresholdStop === true && worst === "ok") worst = "warn";
				} else {
					// Coding（及 follow）：5h / 周窗口任意一个用完（已用 ≥ 100%）
					// 或（follow 下）余额耗尽 → 红；有任何可用数据 → 绿；否则灰。
					var anyRed = false;
					var anyData = false;
					if (codingView && !codingError) {
						anyData = true;
						var codingWindows = codingView.windows || {};
						["rolling", "weekly"].forEach(function (k) {
							var w = codingWindows[k];
							if (w && w.percent !== null && w.percent !== undefined && w.percent >= 100) anyRed = true;
						});
					}
					if (callMode === "follow" && apiView && !apiError) {
						anyData = true;
						if (apiView.cash && typeof apiView.cash.balance === "number" && apiView.cash.balance <= 0) anyRed = true;
					}
					worst = anyRed ? "error" : (anyData ? "ok" : "muted");
				}

				var guardSyncedRef = React.useRef(null);
				React.useEffect(function () {
					var key = callMode + ":" + (guardActive ? "guard" : "open");
					if (guardSyncedRef.current === key) return;
					guardSyncedRef.current = key;
					if (callMode !== "api" && callMode !== "coding") return;
					call("set-call-mode", { mode: callMode, guard: guardActive }).catch(function (e) {
						guardSyncedRef.current = null;
					});
				}, [callMode, guardActive]);

				// ── collapsed: right-edge vertical tab ───────────────────
				if (!expanded) {
					var tabTopPx = dragTopLive !== null ? dragTopLive : (typeof settings.tabTop === "number" ? settings.tabTop : null);
					var tabStyle = tabTopPx !== null ? { top: tabTopPx + "px", transform: "none" } : null;
					var tabClass = "dzb-tab" + (settings.draggableTab ? " dzb-draggable" : "") + (dragTopLive !== null ? " dzb-dragging" : "");
					return React.createElement("div", { id: "dsh-zhipu-balance" },
						React.createElement("button", {
							id: "dzb-tab", type: "button", className: tabClass, style: tabStyle,
							"aria-label": t("expand"), "aria-expanded": "false",
							onPointerDown: function (e) {
								if (!settings.draggableTab) return;
								var rect = e.currentTarget.getBoundingClientRect();
								dragState.current = { active: true, startY: e.clientY, origTop: rect.top, top: rect.top, moved: false, suppressClick: false };
								try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
							},
							onPointerMove: function (e) {
								var st = dragState.current;
								if (!st || !st.active) return;
								var dy = e.clientY - st.startY;
								if (!st.moved && Math.abs(dy) > 4) st.moved = true;
								if (st.moved) {
									st.top = Math.min(window.innerHeight - 80, Math.max(12, st.origTop + dy));
									setDragTopLive(st.top);
								}
							},
							onPointerUp: function (e) {
								var st = dragState.current;
								if (!st || !st.active) return;
								st.active = false;
								st.suppressClick = st.moved;
								try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) {}
								if (st.moved) {
									updateSettings(Object.assign({}, settings, { tabTop: Math.round(st.top) }));
									setDragTopLive(null);
								}
							},
							onClick: function () {
								if (dragState.current.suppressClick) {
									dragState.current.suppressClick = false;
									return;
								}
								setExpanded(true);
							}
						},
							React.createElement("span", { className: "dzb-dot state-" + worst }),
							React.createElement("span", null, t("tab"))));
				}

				// ── expanded: right-side drawer ──────────────────────────
				var body = [];
				if (settingsOpen) {
					body.push(React.createElement(SettingsPanel, {
						key: "settings", t: t, settings: settings, onChange: updateSettings,
						specs: specs, call: call,
						defaults: { warnPercent: specs ? specs.warnPercent : 70, errorPercent: specs ? specs.errorPercent : 90 }
					}));
				} else if (loadError !== null) {
					body.push(React.createElement("div", { key: "err", className: "dzb-error" }, String(loadError)));
				} else {
					var collapsedMap = settings.collapsed || {};
					var toggleSection = function (key) {
						var next = Object.assign({}, collapsedMap);
						if (next[key]) delete next[key];
						else next[key] = true;
						updateSettings(Object.assign({}, settings, { collapsed: next }));
					};
					var foldOf = function (key) {
						return { key: key, collapsed: !!collapsedMap[key], onToggle: function () { toggleSection(key); } };
					};
					if (apiVisible) {
						var apiChildren = [];
						if (apiError) {
							apiChildren.push(React.createElement("div", { key: "err", className: "dzb-error" }, apiError));
						} else if (!apiView) {
							apiChildren.push(React.createElement("div", { key: "hint", className: "dzb-hint" }, t("fetchFailed")));
						} else {
							var packs = apiView.packs;
							if (packs && packs.length > 0) {
								// 已用完（剩 0 / 已用 100%）或已过期/已作废的包沉到
								// 底部"已失效"子节，默认折叠；状态点也忽略它们。
								var packDepleted = function (pk) {
									return (pk.percent !== null && pk.percent !== undefined && pk.percent >= 100)
										|| pk.status === "EXPIRED" || pk.status === "CANCELLED";
								};
								var activePacks = [];
								var inactivePacks = [];
								for (var pi = 0; pi < packs.length; pi++) {
									var pk = packs[pi];
									(packDepleted(pk) ? inactivePacks : activePacks).push(pk);
								}
								for (pi = 0; pi < activePacks.length; pi++) {
									apiChildren.push(PackRow(t, activePacks[pi], warn, error));
								}
								if (inactivePacks.length > 0) {
									var inactiveKey = "packs-inactive";
									// Default collapsed (undefined); the toggle writes the
									// explicit boolean — toggleSection's "undefined = open"
									// semantics would fight that default.
									var inactiveCollapsed = collapsedMap[inactiveKey] !== false;
									apiChildren.push(React.createElement("div", { key: "packs-inactive-title" },
										SectionTitle("已失效", null, { collapsed: inactiveCollapsed, onToggle: function () {
											var next = Object.assign({}, collapsedMap);
											next[inactiveKey] = inactiveCollapsed ? false : true;
											updateSettings(Object.assign({}, settings, { collapsed: next }));
										} })));
									if (!inactiveCollapsed) {
										for (pi = 0; pi < inactivePacks.length; pi++) {
											apiChildren.push(PackRow(t, inactivePacks[pi], warn, error));
										}
									}
								}
							} else {
								// Packs unavailable or empty: surface why, then fall back
								// to the account-level quota windows (coding-plan style).
								if (apiView.packsError) {
									apiChildren.push(React.createElement("div", { key: "packerr", className: "dzb-error" },
										t("packsFailed") + "：" + apiView.packsError));
								} else if (packs) {
									apiChildren.push(React.createElement("div", { key: "packempty", className: "dzb-hint" }, t("packsEmpty")));
								}
								if (apiView.entries.length > 0) {
									if (apiChildren.length > 0) apiChildren.push(React.createElement("div", { key: "pdiv", className: "dzb-divider" }));
									for (var ei = 0; ei < apiView.entries.length; ei++) {
										apiChildren.push(EntryRow(t, apiView.entries[ei], warn, error));
									}
								} else if (!apiView.packsError && !packs) {
									apiChildren.push(React.createElement("div", { key: "hint", className: "dzb-hint" }, t("apiNoData")));
								}
							}
						}
						// ── 模型用量：独立折叠节，置于最上（当月 + 当日）──
						if (settings.showModelUsage && apiView && !apiError) {
							// Data comes from the expense bill (账期 出账中), which
							// books near-real-time — no more multi-day backfill lag.
							var usageChildren = [];
							var bill = apiView.bill;
							// ── API 消耗预警：面板内直接配置 ──
							var thrGate = !collapsedMap["usage-threshold"];
							usageChildren.push(React.createElement("div", { key: "thr-divider", className: "dzb-divider" }));
							usageChildren.push(React.createElement("div", { key: "thr-title" },
								SectionTitle(t("apiThresholdTitle"), null, foldOf("usage-threshold"))));
							if (thrGate) {
								usageChildren.push(React.createElement("div", { key: "thr-type", className: "dzb-setting-row" },
									React.createElement("span", { className: "dzb-setting-name" }, t("apiThresholdType")),
									React.createElement("select", {
										value: settings.apiThresholdPeriod,
										onChange: function (e) {
											updateSettings(Object.assign({}, settings, { apiThresholdPeriod: e.target.value }));
										}
									},
										React.createElement("option", { key: "month", value: "month" }, t("thrPeriodMonth")),
										React.createElement("option", { key: "today", value: "today" }, t("thrPeriodToday")))));
								// 预警值：值输入框（可手输，也可从预设下拉选；千分位显示）+ 单位下拉（¥ / token）。
								usageChildren.push(React.createElement("div", { key: "thr-value", className: "dzb-setting-row" },
									React.createElement("span", { className: "dzb-setting-name" }, t("apiThresholdValue")),
									React.createElement("input", {
										type: "text", inputMode: "decimal",
										list: "dzb-thr-presets",
										value: settings.apiThresholdValue === null ? "" : settings.apiThresholdValue.toLocaleString("en-US"),
										placeholder: settings.apiThresholdUnit === "cny" ? "如 50" : "如 1000000",
										onChange: function (e) {
											var v = Number(e.target.value.replace(/,/g, ""));
											updateSettings(Object.assign({}, settings, { apiThresholdValue: e.target.value === "" || !isFinite(v) || v <= 0 ? null : v }));
										}
									}),
									React.createElement("select", {
										value: settings.apiThresholdUnit,
										onChange: function (e) {
											updateSettings(Object.assign({}, settings, { apiThresholdUnit: e.target.value }));
										}
									},
										React.createElement("option", { key: "token", value: "token" }, "token"),
										React.createElement("option", { key: "cny", value: "cny" }, "¥"))));
									usageChildren.push(React.createElement("div", { key: "thr-stop", className: "dzb-setting-row" },
										React.createElement("span", { className: "dzb-setting-name", style: settings.apiThresholdValue === null ? { opacity: 0.5 } : null }, t("apiThresholdStop")),
										React.createElement("input", {
											type: "checkbox",
											checked: settings.apiThresholdStop === true && settings.apiThresholdValue !== null,
											disabled: settings.apiThresholdValue === null,
											title: settings.apiThresholdValue === null ? t("thrStopNeedValue") : undefined,
											onChange: function (e) {
												updateSettings(Object.assign({}, settings, { apiThresholdStop: e.target.checked }));
											}
										})));
									// 守卫提示：仅当已勾选停止调用且达到阈值时，出现在本块底部。
									if (apiThresholdExceeded && settings.apiThresholdStop) {
										usageChildren.push(React.createElement("div", { key: "guard", className: "dzb-hint" }, t("guardNotice")));
									}
								}
							usageChildren.push(React.createElement("div", { key: "usage-divider", className: "dzb-divider" }));
							usageChildren.push(React.createElement("div", { key: "usage-title" },
								SectionTitle("当月", null, foldOf("usage-month"))));
							var monthGate = !collapsedMap["usage-month"];
							if (monthGate) {
								if (bill && bill.models && bill.models.length > 0) {
									for (var m = 0; m < bill.models.length; m++) {
										var model = bill.models[m];
										usageChildren.push(React.createElement("div", { key: model.name, className: "dzb-row" },
											React.createElement("div", { className: "dzb-row-head" },
												React.createElement("span", { className: "dzb-row-label" }, model.name),
												React.createElement("span", { className: "dzb-row-value" },
													fmtTokens(model.tokens) + (model.amount > 0 ? " · ¥" + model.amount.toFixed(2) : "")))));
									}
								} else {
									usageChildren.push(React.createElement("div", { key: "usage-empty", className: "dzb-hint" }, "暂无当月账单数据"));
								}
							}
							// 余额 + 当月总消耗行：左余额，右 tokens 合计 · 当月消费。
							var monthTokensTotal = 0;
							if (bill && bill.models) for (var mi = 0; mi < bill.models.length; mi++) monthTokensTotal += bill.models[mi].tokens;
							usageChildren.push(React.createElement("div", { key: "bill-spend", className: "dzb-row" },
								React.createElement("div", { className: "dzb-row-head" },
									React.createElement("span", { className: "dzb-row-label", style: { color: "var(--dsw-alias-label-secondary,#61666b)" } },
										apiView.cash && typeof apiView.cash.balance === "number" ? "余额 ¥" + apiView.cash.balance.toFixed(2) : ""),
									React.createElement("span", { className: "dzb-row-value", style: { color: "var(--dsw-alias-label-secondary,#61666b)" } },
										(typeof bill.monthSpend === "number" ? "当月消费 ¥" + bill.monthSpend.toFixed(2) : "")
										+ (monthTokensTotal > 0 ? "（" + fmtTokens(monthTokensTotal) + "）" : "")))));
							usageChildren.push(React.createElement("div", { key: "usage-day-divider", className: "dzb-divider" }));
							usageChildren.push(React.createElement("div", { key: "usage-day-title" },
								SectionTitle("当日", null, foldOf("usage-day"))));
								var dayGate = !collapsedMap["usage-day"];
								if (dayGate) {
									if (bill && bill.today && bill.today.models && bill.today.models.length > 0) {
										var dayTokensTotal = 0;
										for (var td = 0; td < bill.today.models.length; td++) {
											var todayModel = bill.today.models[td];
											dayTokensTotal += todayModel.tokens;
											usageChildren.push(React.createElement("div", { key: "d-" + todayModel.name, className: "dzb-row" },
												React.createElement("div", { className: "dzb-row-head" },
													React.createElement("span", { className: "dzb-row-label" }, todayModel.name),
													React.createElement("span", { className: "dzb-row-value" },
														fmtTokens(todayModel.tokens) + (todayModel.amount > 0 ? " · ¥" + todayModel.amount.toFixed(2) : "")))));
										}
										usageChildren.push(React.createElement("div", { key: "day-spend", className: "dzb-row" },
											React.createElement("div", { className: "dzb-row-head" },
												React.createElement("span", { className: "dzb-row-label", style: { color: "var(--dsw-alias-label-secondary,#61666b)" } }, "当日消费"),
												React.createElement("span", { className: "dzb-row-value" }, "¥" + bill.today.daySpend.toFixed(2)
													+ (dayTokensTotal > 0 ? "（" + fmtTokens(dayTokensTotal) + "）" : "")))));
									} else {
										usageChildren.push(React.createElement("div", { key: "usage-day-empty", className: "dzb-hint" }, "今日暂无消耗"));
									}
								}
								body.push(React.createElement("div", { key: "usage", className: "dzb-section" },
								SectionTitle("模型用量", null, foldOf("usage")),
								!collapsedMap.usage ? usageChildren : null));
						}
						body.push(React.createElement("div", { key: "api", className: "dzb-section" },
							SectionTitle(t("sectionPacks"), apiView ? apiView.plan : null, foldOf("api")),
							!collapsedMap.api ? apiChildren : null));
					}
					if (codingVisible) {
						var codingChildren = [];
						if (codingError) codingChildren.push(React.createElement("div", { key: "err", className: "dzb-error" }, codingError));
						else if (!codingView) codingChildren.push(React.createElement("div", { key: "hint", className: "dzb-hint" }, t("fetchFailed")));
						else {
							var winLabels = { rolling: t("winRolling"), weekly: t("winWeekly"), monthly: t("winMonthly") };
							["rolling", "weekly", "monthly"].forEach(function (k) {
								if (codingView.windows[k]) codingChildren.push(WindowRow(t, winLabels[k], codingView.windows[k], warn, error));
							});
							if (codingChildren.length === 0) codingChildren.push(React.createElement("div", { key: "hint", className: "dzb-hint" }, t("apiNoData")));
						}
						// ── 预警阈值：面板内直接配置（可折叠） ──
						codingChildren.push(React.createElement("div", { key: "cthr-divider", className: "dzb-divider" }));
						codingChildren.push(React.createElement("div", { key: "cthr-title" },
							SectionTitle(t("settingsThresholds"), null, foldOf("coding-threshold"))));
						if (!collapsedMap["coding-threshold"]) {
							codingChildren.push(React.createElement("div", { key: "cthr-warn", className: "dzb-setting-row" },
								React.createElement("span", { className: "dzb-setting-name" }, t("warnPercent")),
								React.createElement("input", {
									type: "number", min: 1, max: 99,
									value: settings.warnPercent === null ? "" : String(settings.warnPercent),
									placeholder: String(specs ? specs.warnPercent : 70),
									onChange: function (e) {
										var v = Number(e.target.value);
										updateSettings(Object.assign({}, settings, { warnPercent: e.target.value === "" ? null : (isFinite(v) ? Math.min(99, Math.max(1, Math.round(v))) : null) }));
									}
								})));
							codingChildren.push(React.createElement("div", { key: "cthr-error", className: "dzb-setting-row" },
								React.createElement("span", { className: "dzb-setting-name" }, t("errorPercent")),
								React.createElement("input", {
									type: "number", min: 1, max: 100,
									value: settings.errorPercent === null ? "" : String(settings.errorPercent),
									placeholder: String(specs ? specs.errorPercent : 90),
									onChange: function (e) {
										var v = Number(e.target.value);
										updateSettings(Object.assign({}, settings, { errorPercent: e.target.value === "" ? null : (isFinite(v) ? Math.min(100, Math.max(1, Math.round(v))) : null) }));
									}
								})));
						}
						// 峰谷时段徽标：高峰 = 北京时间工作日 14:00–18:00。
						var peak = codingPeakState();
						var peakHint = React.createElement("span", {
							key: "peak", className: "dzb-peak " + (peak.isPeak ? "peak" : "off"),
							title: t("peakSchedule")
						}, peak.isPeak ? t("peakOn") : t("peakOff"));
						body.push(React.createElement("div", { key: "coding", className: "dzb-section" },
							SectionTitle(React.createElement("span", null, [t("sectionCoding"), " ", peakHint]), codingView ? codingView.plan : null, foldOf("coding")),
							!collapsedMap.coding ? codingChildren : null));
					}
				}

				return React.createElement("div", { id: "dsh-zhipu-balance" },
					React.createElement("div", { 
						id: "dzb-panel",
						className: settings.whiteBackground ? "dzb-white-bg" : ""
					},
						React.createElement("div", { className: "dzb-header" },
							React.createElement("div", { className: "dzb-title" }, t("title")),
							React.createElement("button", {
								className: "dzb-icon" + (refreshing ? " is-loading" : ""), type: "button",
								"aria-label": t("refresh"), disabled: refreshing,
								onClick: function () { refreshAll(); }
							}, "↻"),
							React.createElement("button", {
								className: "dzb-icon" + (settingsOpen ? " is-active" : ""), type: "button",
								"aria-label": settingsOpen ? t("closeSettings") : t("openSettings"),
								"aria-expanded": settingsOpen ? "true" : "false",
								onClick: function () { setSettingsOpen(!settingsOpen); }
							}, "⚙"),
							React.createElement("button", {
								className: "dzb-icon", type: "button", "aria-label": t("collapse"),
								onClick: function () { setExpanded(false); }
							}, "▸")),
						React.createElement("div", { className: "dzb-body" }, body),
						React.createElement("div", { className: "dzb-footer" },
							fetchedAt !== null ? t("updatedAt", { time: new Date(fetchedAt).toLocaleTimeString() }) : "")),
					// 预警值预设（输入框下拉可选，也可手输任意值；千分位显示）
					React.createElement("datalist", { id: "dzb-thr-presets" },
						[10, 20, 30, 50, 1000000, 3000000, 5000000, 10000000, 50000000, 100000000, 1000000000].map(function (v) {
							return React.createElement("option", { key: v, value: v.toLocaleString("en-US") });
						})));
			}

			ctx.effect(function () {
				return ctx.locale.register(NS, DICT);
			}, "dsh-zhipu-balance: dictionaries");
			var t = ctx.locale.bind(NS);
			ctx.slots.inject("shell.overlay", function () {
				return ctx.slots.register(
					{ name: "shell.overlay", id: "dsh-zhipu-balance", order: 90, label: function () { return t("title"); }, locale: NS },
					function (props) { return React.createElement(Panel, { t: props.t }); });
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
