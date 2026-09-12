/**
 * dsh-zhipu-balance — host half.
 *
 * Zhipu (智谱 / BigModel) balance & usage panel for the dsh web surface.
 * Derived from the community plugin `dsh-quota-panel` (MIT, wenzetan) and
 * re-scoped to Zhipu only, with a right-edge collapsible panel and
 * resource-pack aware normalization.
 *
 * This half:
 *   - resolves API keys through `ctx.credentials` (never sent to the browser);
 *   - calls the Zhipu usage monitor endpoints with `Authorization: Bearer <key>`
 *     (falls back to the raw key on 401, mirroring community tooling);
 *   - normalizes upstream JSON into row views the browser half renders
 *     generically (api quota/resource-pack entries, coding-plan windows,
 *     per-model usage detail);
 *   - serves the loopback Connection RPC channel `/dsh-zhipu-balance` with
 *     two endpoints: `specs` (render hints) and `fetch-all` (normalized rows).
 *
 * Endpoints (community-verified, undocumented but stable):
 *   GET {base}/api/monitor/usage/quota/limit
 *     → { code: 200, data: { level?, limits: [{ type, unit, percentage,
 *           nextResetTime, remaining?, number?, currentValue?, usage? }] } }
 *     unit codes: 3 = 5h window, 6 = weekly, 5 = MCP monthly (TIME_LIMIT).
 *   GET {base}/api/monitor/usage/model-usage?startTime=..&endTime=..
 *     → { code: 200, data: { modelSummaryList: [{ name-ish, tokens-ish }] } }
 *     window params are naive Asia/Shanghai local time strings.
 *   GET {base}/api/biz/tokenAccounts/list/my?pageNum=1&pageSize=100&filterEnabled=false
 *     → { code: 200, total, rows: [{ resourcePackageName, tokensMagnitude,
 *           tokenBalance, availableBalance, frozenBalance, consumeType,
 *           suitableScene, suitableModel, status, type, packageExpirationTime }] }
 *     Console 资源包管理 backing API; accepts the same API key auth.
 *     consumeType: TOKENS | TIMES; status: EFFECTIVE | NOTUSED | EXPIRED | CANCELLED.
 *   GET {base}/api/biz/account/query-customer-account-report
 *     → { code: 200, data: { balance, availableBalance, rechargeAmount,
 *           giveAmount, totalSpendAmount, frozenBalance, creditBalance,
 *           creditStatus } }
 *     Console 财务总览 backing API (cash ¥ balance); accepts the same key auth.
 *
 * Zero runtime dependencies: the schema library is vendored under lib/vendor.
 */

import z from './vendor/schemastery.mjs';

export const name = 'zhipu-balance';

// dsh >= 0.1.5: the channel's HTTP route is registered on `webServer` by this
// plugin itself — `ctx.connection.rpc.handle` resolves webServer through the
// connection plugin's own fiber there, which lacks the inject and throws.
export const inject = ['connection', 'credentials', 'settings', 'webServer'];

/** Loopback-only Connection RPC channel this plugin owns. */
export const RPC_CHANNEL = '/dsh-zhipu-balance';

/** Upstream fetch timeout per request. */
const UPSTREAM_TIMEOUT_MS = 15000;

/** Upper bound on one upstream response body kept in memory (bytes). */
const MAX_BODY_BYTES = 1024 * 1024;

const CREDENTIAL_REF_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const HTTP_URL_PATTERN = /^https?:\/\//;

const DEFAULT_API_REFS = ['ZHIPU_API_KEY', 'GLM_API_KEY'];
const DEFAULT_CODING_REFS = ['ZAI_CODING_CN_API_KEY'];
const DEFAULT_API_BASE = 'https://open.bigmodel.cn';
const DEFAULT_CODING_BASE = 'https://open.bigmodel.cn';

/**
 * Call-mode → LLM provider baseURL. The two Zhipu surfaces bill through
 * different endpoints: pay-as-you-go API keys call /api/paas/v4 while the
 * Coding Plan subscription calls /api/coding/paas/v4. Switching modes rewrites
 * llm-pi-ai.providers['zai-coding-cn'].baseURL via the settings service.
 */
const CALL_MODE_BASE_URLS = {
	api: 'https://open.bigmodel.cn/api/paas/v4',
	coding: 'https://open.bigmodel.cn/api/coding/paas/v4'
};

/**
 * Threshold-guard sink: port 9 (discard) on loopback refuses connections
 * immediately, so guarded model calls fail fast without reaching Zhipu and
 * without billing. Lifting the guard restores the mode's real baseURL.
 */
const CALL_GUARD_BASE_URL = 'http://127.0.0.1:9/zhipu-balance-threshold-guard';

/** Monitor unit codes seen in the wild (pi-glm-usage / glm-plan-usage2 research). */
const UNIT_LABELS = { 3: '5h 窗口', 6: '周窗口', 5: 'MCP 月度' };

/** Plugin config schema; defaults let profile patches omit everything. */
export const Config = z.object({
	refreshMs: z.number().min(5000).default(60000),
	apiRefs: z.array(z.string().pattern(CREDENTIAL_REF_PATTERN)).default(DEFAULT_API_REFS),
	apiBaseUrl: z.string().pattern(HTTP_URL_PATTERN).default(DEFAULT_API_BASE),
	codingRefs: z.array(z.string().pattern(CREDENTIAL_REF_PATTERN)).default(DEFAULT_CODING_REFS),
	codingBaseUrl: z.string().pattern(HTTP_URL_PATTERN).default(DEFAULT_CODING_BASE),
	usageDetail: z.boolean().default(true),
	warnPercent: z.number().min(1).max(99).default(70),
	errorPercent: z.number().min(1).max(100).default(90)
});

/** First credential reference that resolves, or null. */
async function firstResolvedRef(ctx, refs) {
	for (const ref of refs) {
		if (!CREDENTIAL_REF_PATTERN.test(ref)) continue;
		let hit = null;
		try {
			hit = await ctx.credentials.resolve(ref);
		} catch {
			hit = null;
		}
		if (hit && typeof hit.value === 'string' && hit.value.length > 0) return { ref, value: hit.value };
	}
	return null;
}

/**
 * Fetch one URL as JSON with the auth-scheme fallback used by community GLM
 * tools: Bearer first; on 401 retry the raw key. Returns
 * `{ ok, status, body }` where body is the parsed JSON (null when not JSON).
 * Auth failures surface as `{ ok: false, status: 401, body }`.
 */
async function fetchMonitorJson(url, key, rememberScheme) {
	const schemes = rememberScheme?.scheme === 'raw' ? ['raw', 'bearer'] : ['bearer', 'raw'];
	let lastStatus = 0;
	for (let i = 0; i < schemes.length; i++) {
		const scheme = schemes[i];
		const headers = {
			authorization: scheme === 'bearer' ? `Bearer ${key}` : key,
			accept: 'application/json',
			'user-agent': 'dsh-zhipu-balance'
		};
		let res;
		try {
			res = await fetch(url, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
		} catch (error) {
			const reason = error && error.name === 'TimeoutError' ? 'timed out' : String((error && error.message) || error);
			return { ok: false, status: 0, error: `请求失败: ${reason}` };
		}
		lastStatus = res.status;
		let body = null;
		try {
			const raw = await res.arrayBuffer();
			if (raw.byteLength > MAX_BODY_BYTES) return { ok: false, status: res.status, error: `响应超过 ${MAX_BODY_BYTES} 字节` };
			body = JSON.parse(new TextDecoder().decode(raw));
		} catch {
			body = null;
		}
		if (res.status === 401 && i < schemes.length - 1) continue;
		if (rememberScheme) rememberScheme.scheme = scheme;
		if (!res.ok) {
			const msg = body && typeof body === 'object' && (body.msg || body.message || body?.error?.message);
			return { ok: false, status: res.status, error: `HTTP ${res.status}${msg ? `: ${msg}` : ''}` };
		}
		if (body === null) return { ok: false, status: res.status, error: `HTTP ${res.status}: 非 JSON 响应` };
		if (typeof body === 'object' && body.code !== undefined && body.code !== 200) {
			const msg = body.msg || body.message || '未知错误';
			if (String(body.code) === '1001') return { ok: false, status: 401, error: 'API Key 未通过身份验证' };
			return { ok: false, status: res.status, error: `上游 code ${body.code}: ${msg}` };
		}
		return { ok: true, status: res.status, body };
	}
	return { ok: false, status: lastStatus, error: `HTTP ${lastStatus}` };
}

/**
 * Normalize one `limits[]` entry into a renderable row. Handles every field
 * shape seen across key types:
 *   - `percentage`          → used percent (coding-plan style, authoritative)
 *   - `remaining` + `number`→ remaining/total absolute counts (quota / packs)
 *   - `currentValue`+`usage`→ used/total absolute counts (coding-plan style)
 */
function normalizeLimit(entry) {
	if (!entry || typeof entry !== 'object') return null;
	const num = (v) => {
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	};
	const toIso = (v) => {
		const n = num(v);
		return n !== null && n > 0 ? new Date(n > 1e12 ? n : n * 1000).toISOString() : undefined;
	};
	const labelOf = (e) => {
		const unit = Number(e.unit);
		if (Number.isInteger(unit) && UNIT_LABELS[unit]) return UNIT_LABELS[unit];
		for (const field of ['name', 'nickname', 'packageName', 'resourceName', 'title']) {
			if (typeof e[field] === 'string' && e[field]) return e[field];
		}
		if (typeof e.type === 'string' && e.type) {
			// Map known type codes to friendlier labels.
			if (e.type === 'TOKENS_LIMIT') return num(e.unit) === 6 ? '周窗口' : 'Token 额度';
			if (e.type === 'TIME_LIMIT') return 'MCP 月度';
			return e.type;
		}
		return '额度';
	};
	const label = labelOf(entry);
	let percent = null;
	let remainingText = null;
	let totalText = null;
	const percentage = num(entry.percentage);
	let remaining = num(entry.remaining);
	const used = num(entry.currentValue);
	// `usage` is the WINDOW/QUOTA TOTAL in Zhipu monitor responses (verified
	// live: CREDIT_LIMIT carries number=plan multiplicity, usage=quota size,
	// currentValue=used, remaining=left) — prefer it over `number` for totals.
	const total = num(entry.usage) ?? num(entry.number);
	if (remaining === null && used !== null && total !== null) remaining = total - used;
	if (percentage !== null) {
		percent = Math.min(100, Math.max(0, Math.round(percentage)));
	} else if (used !== null && total !== null && total > 0) {
		percent = Math.min(100, Math.max(0, Math.round((used / total) * 100)));
	} else if (remaining !== null && total !== null && total > 0) {
		percent = Math.min(100, Math.max(0, Math.round(((total - remaining) / total) * 100)));
	}
	if (remaining !== null) remainingText = String(remaining);
	if (total !== null) totalText = String(total);
	const resetsAt = toIso(entry.nextResetTime ?? entry.resetTime ?? entry.endTime);
	const hover = Object.entries(entry)
		.filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
		.map(([k, v]) => `${k}: ${v}`)
		.join('\n');
	return { label, percent, remainingText, totalText, resetsAt, hover };
}

/**
 * Normalize one resource-pack row (`/biz/tokenAccounts/list/my`).
 * Field semantics (live-verified against the console 资源包管理):
 *   tokensMagnitude   original pack size (tokens for TOKENS packs, count for TIMES)
 *   availableBalance  spendable balance now
 *   tokenBalance      recorded balance (≈ available + frozen)
 *   frozenBalance     reserved portion
 *   packageExpirationTime  naive Beijing local datetime string
 * Used = tokensMagnitude − availableBalance (clamped at 0).
 */
function normalizePack(row) {
	if (!row || typeof row !== 'object') return null;
	const num = (v) => {
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	};
	const name = String(row.resourcePackageName ?? row.name ?? '').trim();
	if (!name) return null;
	const unitRaw = String(row.consumeType ?? '').toUpperCase();
	const unit = unitRaw === 'TIMES' ? 'times' : unitRaw === 'TOKENS' ? 'tokens' : unitRaw ? unitRaw.toLowerCase() : 'tokens';
	const total = num(row.tokensMagnitude) ?? num(row.tokenBalance);
	const available = num(row.availableBalance) ?? num(row.tokenBalance);
	const frozen = num(row.frozenBalance) ?? 0;
	const used = total !== null && available !== null ? Math.max(0, total - available) : null;
	let percent = null;
	if (used !== null && total !== null && total > 0) {
		percent = Math.min(100, Math.max(0, Math.round((used / total) * 100)));
	} else if (total !== null && total <= 0) {
		percent = 100;
	}
	let expiresAt;
	const rawExpiry = row.packageExpirationTime ?? row.expirationTime;
	if (typeof rawExpiry === 'string' && rawExpiry) {
		const parsed = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(rawExpiry) ? rawExpiry : `${rawExpiry}+08:00`);
		if (!Number.isNaN(parsed.getTime())) expiresAt = parsed.toISOString();
	}
	return {
		name,
		unit,
		status: String(row.status ?? '').toUpperCase() || undefined,
		type: typeof row.type === 'string' && row.type ? row.type : undefined,
		total,
		available,
		frozen,
		used,
		percent,
		expiresAt,
		scene: typeof row.suitableScene === 'string' && row.suitableScene ? row.suitableScene : undefined,
		models: typeof row.suitableModel === 'string' && row.suitableModel ? row.suitableModel : undefined
	};
}

/** Turn the `/biz/tokenAccounts/list/my` response into the packs view. */
function adaptPackages(body) {
	if (!body || typeof body !== 'object' || body.code !== 200) {
		throw new Error(`上游 code ${body && body.code}: ${(body && (body.msg || body.message)) || '未知错误'}`);
	}
	const rows = Array.isArray(body.rows) ? body.rows : [];
	if (rows.length === 0 && !(typeof body.total === 'number' && body.total === 0)) {
		throw new Error('响应中没有资源包数据');
	}
	const packs = rows.map(normalizePack).filter(Boolean);
	// Effective packs first, then soonest-expiring — mirrors the console list.
	const statusRank = { EFFECTIVE: 0, NOTUSED: 1, EXPIRED: 2, CANCELLED: 3 };
	packs.sort((a, b) => {
		const ra = statusRank[a.status] ?? 4;
		const rb = statusRank[b.status] ?? 4;
		if (ra !== rb) return ra - rb;
		return String(a.expiresAt ?? '9999').localeCompare(String(b.expiresAt ?? '9999'));
	});
	return packs;
}

/** Turn `data.limits[]` into the api row view (quota + resource-pack lines). */
function adaptApiQuota(body) {
	if (!body || typeof body !== 'object' || body.code !== 200) {
		throw new Error(`上游 code ${body && body.code}: ${(body && (body.msg || body.message)) || '未知错误'}`);
	}
	const data = body.data && typeof body.data === 'object' ? body.data : {};
	const limits = Array.isArray(data.limits) ? data.limits : [];
	const entries = limits.map(normalizeLimit).filter(Boolean);
	if (entries.length === 0) throw new Error('响应中没有可解析的额度条目');
	const level = typeof data.level === 'string' && data.level ? data.level : undefined;
	const plan = data.planName ?? data.plan ?? data.packageName ?? level;
	return { kind: 'api', plan: plan != null ? String(plan) : undefined, entries };
}

/** Turn the coding-plan quota response into window rows (5h / week / MCP). */
function adaptCodingQuota(body) {
	if (!body || typeof body !== 'object' || body.code !== 200) {
		throw new Error(`上游 code ${body && body.code}: ${(body && (body.msg || body.message)) || '未知错误'}`);
	}
	const data = body.data && typeof body.data === 'object' ? body.data : {};
	const limits = Array.isArray(data.limits) ? data.limits : [];
	if (limits.length === 0) throw new Error('响应中没有可解析的额度条目');
	const pct = (l) => {
		const n = Number(l && l.percentage);
		if (Number.isFinite(n)) return Math.min(100, Math.max(0, Math.round(n)));
		// Fallback from raw counts; null renders as "无数据" instead of a fake 0%.
		const used = Number(l && l.currentValue);
		const total = Number(l && l.usage);
		if (Number.isFinite(used) && Number.isFinite(total) && total > 0) return Math.round((used / total) * 100);
		return null;
	};
	const resets = (l) => {
		const n = Number(l && l.nextResetTime);
		return Number.isFinite(n) && n > 0 ? new Date(n > 1e12 ? n : n * 1000).toISOString() : undefined;
	};
	// Credit amounts (live-verified: usage=window total, currentValue=used,
	// remaining=left) — the coding section renders 剩 X / 共 Y from these.
	const amounts = (l) => {
		const num = (v) => {
			const n = Number(v);
			return Number.isFinite(n) ? n : null;
		};
		const total = num(l && l.usage) ?? num(l && l.number);
		let remaining = num(l && l.remaining);
		const used = num(l && l.currentValue);
		if (remaining === null && used !== null && total !== null) remaining = total - used;
		const out = {};
		if (total !== null) out.total = total;
		if (remaining !== null) out.remaining = remaining;
		return out;
	};
	// TOKENS_LIMIT is the documented coding-plan shape; CREDIT_LIMIT is the
	// credit-based plan shape (verified live, same unit codes). Entries with no
	// type still parse — the unit code carries the window semantics.
	const tokens = limits.filter((l) => l && (l.type === 'TOKENS_LIMIT' || l.type === 'CREDIT_LIMIT' || l.type === undefined || l.type === ''));
	const time = limits.find((l) => l && l.type === 'TIME_LIMIT') ?? tokens.find((l) => Number(l.unit) === 5);
	let rolling = tokens.find((l) => Number(l.unit) === 3);
	let weekly = tokens.find((l) => Number(l.unit) === 6);
	if (!rolling && !weekly && tokens.length > 0) {
		// Unknown unit codes: order by reset time — 5h always resets first.
		const sorted = [...tokens].sort((a, b) => Number(a.nextResetTime ?? Infinity) - Number(b.nextResetTime ?? Infinity));
		rolling = sorted[0];
		weekly = sorted.length > 1 ? sorted[sorted.length - 1] : undefined;
	}
	const windows = {};
	if (rolling) windows.rolling = { percent: pct(rolling), resetsAt: resets(rolling), ...amounts(rolling) };
	if (weekly && weekly !== rolling) windows.weekly = { percent: pct(weekly), resetsAt: resets(weekly), ...amounts(weekly) };
	if (time && time !== rolling && time !== weekly) windows.monthly = { percent: pct(time), resetsAt: resets(time), ...amounts(time) };
	if (Object.keys(windows).length === 0) throw new Error('没有 TOKENS_LIMIT / TIME_LIMIT 条目');
	const plan = data.planName ?? data.plan ?? data.packageName ?? data.level;
	return { kind: 'coding', plan: plan != null ? String(plan) : undefined, windows };
}

/**
 * Current calendar month (Beijing) as `YYYY-MM`, the bill period key.
 */
function beijingMonth() {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit'
	}).format(new Date());
}

/**
 * Best-effort current-month bill (Beijing), straight from the console's
 * expense-bill APIs — books usage in near-real-time (账期状态 出账中), unlike
 * the model-usage monitor whose backfill lags by days. Aggregates per-model
 * tokens and settlement amounts for the month AND for today (from the
 * per-order daily list); null when unavailable (never throws).
 * GET {base}/api/finance/chartBill/product/{YYYY-MM}
 * GET {base}/api/finance/expenseBill/expenseBillListByDay?billingMonth={YYYY-MM}
 */
async function fetchBillDetail(baseUrl, key, schemeState) {
	const month = beijingMonth();
	const today = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
	}).format(new Date());
	const cleanBase = baseUrl.replace(/\/+$/, '');
	// 当日数据从「费用明细」接口取：按天视图只出已完结的天（今天要明天才有），
	// 而明细里的行是实时的（billingDate = 今天）。明细行按账期倒序返回，
	// pageSize=500 已覆盖重账单月里今天的行。
	const [monthResult, dayResult] = await Promise.all([
		fetchMonitorJson(`${cleanBase}/api/finance/chartBill/product/${month}`, key, schemeState),
		fetchMonitorJson(`${cleanBase}/api/finance/expenseBill/expenseBillList?billingMonth=${month}&pageSize=500&pageNum=1`, key, schemeState)
	]);

	// The month bill splits one model across its pricing tiers (0-32k,
	// 32-128k, …); merge by modelCode so each model shows one total.
	const monthAgg = (rows) => {
		const byModel = new Map();
		let spend = 0;
		for (const item of rows) {
			if (!item || typeof item !== 'object') continue;
			const name = String(item.modelCode ?? item.modelProductName ?? '').trim();
			if (!name) continue;
			const tokens = Number(item.usageCount ?? item.deductUsage ?? 0) || 0;
			const amount = Number(item.settlementAmount ?? item.dueAmount ?? 0) || 0;
			spend += amount;
			const merged = byModel.get(name) ?? { name, tokens: 0, amount: 0 };
			merged.tokens += tokens;
			merged.amount += amount;
			byModel.set(name, merged);
		}
		if (byModel.size === 0) return null;
		const models = [...byModel.values()]
			.map((m) => ({ ...m, amount: Math.round(m.amount * 100) / 100 }))
			.sort((a, b) => b.tokens - a.tokens);
		return { models, spend: Math.round(spend * 100) / 100 };
	};

	const monthRows = monthResult.ok && monthResult.body && Array.isArray(monthResult.body.rows) ? monthResult.body.rows : [];
	const monthAggResult = monthAgg(monthRows);
	const dayRows = dayResult.ok && dayResult.body && Array.isArray(dayResult.body.rows) ? dayResult.body.rows.filter((r) => r && r.billingDate === today) : [];
	const todayAgg = monthAgg(dayRows);
	if (!monthAggResult && !todayAgg) return null;
	return {
		month,
		models: monthAggResult ? monthAggResult.models : [],
		monthSpend: monthAggResult ? monthAggResult.spend : 0,
		today: todayAgg ? { models: todayAgg.models, daySpend: todayAgg.spend } : { models: [], daySpend: 0 }
	};
}

/** Per-row auth-scheme memory (lives for the process lifetime). */
const apiScheme = { scheme: 'bearer' };
const codingScheme = { scheme: 'bearer' };

/** Best-effort resource-pack list; returns packs array or throws. */
async function fetchPackages(baseUrl, key, schemeState) {
	const url = `${baseUrl.replace(/\/+$/, '')}/api/biz/tokenAccounts/list/my`
		+ `?pageNum=1&pageSize=100&filterEnabled=false`;
	const result = await fetchMonitorJson(url, key, schemeState);
	if (!result.ok) throw new Error(result.error);
	return adaptPackages(result.body);
}

/**
 * Cash balance (console 财务总览). Field semantics live-verified:
 * balance=当前余额, availableBalance=可用余额, rechargeAmount=累计充值,
 * giveAmount=赠送金额, totalSpendAmount=总消费, frozenBalance=冻结,
 * creditBalance/creditStatus=信用余额(未开通时 null/NOT_OPEN).
 * Upstream carries ~9 decimal places; the console rounds to 2 — we do too.
 */
function adaptCash(body) {
	if (!body || typeof body !== 'object' || body.code !== 200) {
		throw new Error(`上游 code ${body && body.code}: ${(body && (body.msg || body.message)) || '未知错误'}`);
	}
	const data = body.data && typeof body.data === 'object' ? body.data : {};
	const num = (v) => {
		const n = Number(v);
		return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
	};
	const balance = num(data.balance) ?? num(data.availableBalance);
	if (balance === null) throw new Error('响应中没有余额字段');
	const creditStatus = typeof data.creditStatus === 'string' && data.creditStatus ? data.creditStatus : undefined;
	return {
		balance,
		available: num(data.availableBalance),
		recharge: num(data.rechargeAmount),
		gift: num(data.giveAmount),
		spend: num(data.totalSpendAmount),
		frozen: num(data.frozenBalance),
		credit: num(data.creditBalance),
		creditStatus
	};
}

/** Best-effort cash balance; returns the cash view or throws. */
async function fetchCashBalance(baseUrl, key, schemeState) {
	const url = `${baseUrl.replace(/\/+$/, '')}/api/biz/account/query-customer-account-report`;
	const result = await fetchMonitorJson(url, key, schemeState);
	if (!result.ok) throw new Error(result.error);
	return adaptCash(result.body);
}

/**
 * Fetch the api row (quota / resource packs) plus the usage detail.
 * Returns the RPC row result: `{ id, view }` or `{ id, error }`.
 *
 * The view carries all sources independently (each fails soft):
 *   - `cash`       cash balance (¥; fails soft via `cashError`)
 *   - `packs`      resource packages (fails soft via `packsError`)
 *   - `entries`    account-level quota windows (fallback display + state calc)
 */
async function fetchApiRow(ctx, refs, baseUrl, withDetail) {
	const hit = await firstResolvedRef(ctx, refs);
	if (!hit) return { id: 'api', error: '未找到智谱 API Key（在 $DSH_HOME/.credentials.yaml 配置 ZHIPU_API_KEY）' };
	const quotaUrl = `${baseUrl.replace(/\/+$/, '')}/api/monitor/usage/quota/limit`;
	const soft = (promise, key) => promise.then(
		(value) => ({ [key]: value }),
		(error) => ({ error: String((error && error.message) || error) })
	);
	const [quotaResult, packsResult, cashResult] = await Promise.all([
		fetchMonitorJson(quotaUrl, hit.value, apiScheme),
		soft(fetchPackages(baseUrl, hit.value, apiScheme), 'packs'),
		soft(fetchCashBalance(baseUrl, hit.value, apiScheme), 'cash')
	]);
	if (!quotaResult.ok && packsResult.error) {
		return { id: 'api', error: quotaResult.error };
	}
	let view;
	try {
		view = adaptApiQuota(quotaResult.ok ? quotaResult.body : { code: 200, data: { limits: [] } });
	} catch (error) {
		if (!packsResult.packs) return { id: 'api', error: String((error && error.message) || error) };
		view = { kind: 'api', entries: [] };
	}
	view.credentialRef = hit.ref;
	if (packsResult.packs) view.packs = packsResult.packs;
	else view.packsError = packsResult.error;
	if (cashResult.cash) view.cash = cashResult.cash;
	else view.cashError = cashResult.error;
	if (withDetail) view.bill = await fetchBillDetail(baseUrl, hit.value, apiScheme);
	return { id: 'api', view };
}

/** Fetch the coding-plan row. */
async function fetchCodingRow(ctx, refs, baseUrl) {
	const hit = await firstResolvedRef(ctx, refs);
	if (!hit) return { id: 'coding', error: '未找到 Coding Plan Key（配置 ZAI_CODING_CN_API_KEY）' };
	const url = `${baseUrl.replace(/\/+$/, '')}/api/monitor/usage/quota/limit`;
	const result = await fetchMonitorJson(url, hit.value, codingScheme);
	if (!result.ok) return { id: 'coding', error: result.error };
	try {
		return { id: 'coding', view: adaptCodingQuota(result.body) };
	} catch (error) {
		return { id: 'coding', error: String((error && error.message) || error) };
	}
}

/** JSON-safe render hints for the browser half (no secrets, no endpoints). */
function rowSpecs(config) {
	return [
		{ id: 'api', label: '智谱 API', kind: 'api' },
		{ id: 'coding', label: 'Coding Plan', kind: 'coding' }
	];
}

/** Valid single endpoint path segment (mirrors dsh-client-connection). */
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;

/** Small request-body cap for the channel; panel payloads are a few hundred bytes. */
const MAX_CHANNEL_BODY_BYTES = 1048576;

/**
 * Extract the endpoint segment from a channel-relative pathname.
 * @param pathname - request pathname (e.g. `/dsh-zhipu-balance/specs`).
 * @returns endpoint id, or undefined when the path is not a valid channel target.
 */
function endpointFromPath(pathname) {
	if (!pathname.startsWith(`${RPC_CHANNEL}/`)) return undefined;
	const endpoint = pathname.slice(RPC_CHANNEL.length + 1);
	if (endpoint.split('/').some((segment) => segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) return undefined;
	return endpoint;
}

/** Read and size-cap a request body as UTF-8 text. */
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > MAX_CHANNEL_BODY_BYTES) {
				reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

/**
 * Serve one Connection-RPC channel request over plain Node req/res, speaking
 * the same JSON envelope protocol as dsh-client-connection's own channels.
 * @param ctx - plugin context (connection fence + dispatch).
 * @param req - Node incoming message.
 * @param res - Node server response.
 * @param dispatch - channel handler `(endpoint, payload) => result`.
 */
async function serveChannel(ctx, req, res, dispatch) {
	const rejection = ctx.connection.requestRejection(req);
	if (rejection !== undefined) {
		res.writeHead(rejection);
		res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
		return;
	}
	let endpoint = undefined;
	try {
		endpoint = endpointFromPath(new URL(req.url, 'http://localhost').pathname);
	} catch {
		endpoint = undefined;
	}
	if (req.method !== 'POST' || endpoint === undefined) {
		res.writeHead(404);
		res.end('not found');
		return;
	}
	const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
	if (contentType !== 'application/json') {
		res.writeHead(415);
		res.end('content type must be application/json');
		return;
	}
	let message;
	try {
		message = JSON.parse(await readBody(req));
	} catch (error) {
		res.writeHead(error && error.statusCode === 413 ? 413 : 400);
		res.end(error && error.statusCode === 413 ? 'payload too large' : 'body is not JSON');
		return;
	}
	const rpcId = message && typeof message.rpcId === 'string' ? message.rpcId : 'invalid-request';
	const respond = (result) => {
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ type: 'server-response', rpcId, result }));
	};
	if (!message || message.type !== 'client-request' || rpcId === 'invalid-request' || typeof message.method !== 'string' || !('payload' in message)) {
		respond({ ok: false, error: { code: 'gateway/bad-request', message: 'invalid client-request message', details: {} } });
		return;
	}
	if (message.method !== endpoint) {
		respond({ ok: false, error: { code: 'gateway/bad-request', message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`, details: {} } });
		return;
	}
	let result;
	try {
		result = await dispatch(endpoint, message.payload);
	} catch (error) {
		res.writeHead(500);
		res.end(`handler failure: ${String(error)}`);
		return;
	}
	respond(result);
}

/**
 * Apply the plugin: own the loopback RPC channel for the fiber lifetime.
 * @param ctx - plugin context with connection, credentials, settings and webServer services.
 * @param config - schema-processed config.
 */
export function apply(ctx, config = {}) {
	const cfg = config && typeof config === 'object' ? config : {};
	const refreshMs = Number(cfg.refreshMs) >= 5000 ? Number(cfg.refreshMs) : 60000;
	const apiRefs = Array.isArray(cfg.apiRefs) && cfg.apiRefs.length > 0 ? cfg.apiRefs : DEFAULT_API_REFS;
	const codingRefs = Array.isArray(cfg.codingRefs) && cfg.codingRefs.length > 0 ? cfg.codingRefs : DEFAULT_CODING_REFS;
	const apiBaseUrl = typeof cfg.apiBaseUrl === 'string' && HTTP_URL_PATTERN.test(cfg.apiBaseUrl) ? cfg.apiBaseUrl : DEFAULT_API_BASE;
	const codingBaseUrl = typeof cfg.codingBaseUrl === 'string' && HTTP_URL_PATTERN.test(cfg.codingBaseUrl) ? cfg.codingBaseUrl : DEFAULT_CODING_BASE;
	const withDetail = cfg.usageDetail !== false;
	const warnPercent = Number.isFinite(Number(cfg.warnPercent)) ? Number(cfg.warnPercent) : 70;
	const errorPercent = Number.isFinite(Number(cfg.errorPercent)) ? Number(cfg.errorPercent) : 90;

	const dispatch = async (endpoint, payload) => {
		try {
			if (endpoint === 'specs') {
				let providerBaseURL = null;
				try {
					const section = ctx.settings.get('llm-pi-ai');
					const provider = section && section.providers ? section.providers['zai-coding-cn'] : null;
					providerBaseURL = provider && typeof provider.baseURL === 'string' ? provider.baseURL : null;
				} catch (error) {
					ctx.logger.warn('zhipu-balance: read llm-pi-ai provider failed', error);
				}
				return {
					ok: true,
					value: {
						rows: rowSpecs(cfg),
						refreshMs,
						warnPercent,
						errorPercent,
						providerBaseURL
					}
				};
			}
			if (endpoint === 'set-call-mode') {
				const mode = payload && payload.mode;
				if (mode !== 'api' && mode !== 'coding') {
					return { ok: false, error: { code: 'internal', message: `invalid call mode: ${String(mode)}`, details: {} } };
				}
				// guard=true parks the endpoint on a loopback refuse port (the
				// API-mode manual threshold was crossed with "stop calls" on);
				// guard=false restores the mode's real endpoint.
				const guard = payload.guard === true && mode === 'api';
				const baseURL = guard ? CALL_GUARD_BASE_URL : CALL_MODE_BASE_URLS[mode];
				await ctx.settings.update('llm-pi-ai', { providers: { 'zai-coding-cn': { baseURL } } });
				return { ok: true, value: { mode, guard, baseURL } };
			}
			if (endpoint === 'fetch-all') {
				const [apiRow, codingRow] = await Promise.all([
					fetchApiRow(ctx, apiRefs, apiBaseUrl, withDetail),
					fetchCodingRow(ctx, codingRefs, codingBaseUrl)
				]);
				return { ok: true, value: { rows: [apiRow, codingRow], fetchedAt: Date.now() } };
			}
			return { ok: false, error: { code: 'internal', message: `unknown endpoint: ${String(endpoint)}`, details: {} } };
		} catch (error) {
			return { ok: false, error: { code: 'internal', message: String((error && error.message) || error), details: {} } };
		}
	};
	// dsh >= 0.1.5: register the channel's HTTP route on webServer directly
	// (same envelope protocol and Host/Origin fence as connection-owned
	// channels; requestRejection comes from the connection service).
	ctx.effect(() => ctx.webServer.register({
		kind: 'prefix',
		path: RPC_CHANNEL,
		handler: (req, res) => serveChannel(ctx, req, res, dispatch)
	}), 'zhipu-balance: rpc channel');
}
