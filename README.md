# dsh-zhipu-balance

English | [中文](README.zh.md)

**dsh-zhipu-balance** is a Zhipu (智谱 / BigModel) balance & usage panel for the
DeepSeek Harness web surface (`dsh web`), adapted from the community plugin
[dsh-quota-panel](https://github.com/wenzetan/dsh-quota-panel) (MIT) and
re-scoped to the Zhipu ecosystem.

## Features

- **Call mode** — switch between API Key (`/api/paas/v4`, pay-as-you-go) and
  Coding Plan (`/api/coding/paas/v4`, subscription quota): the host half hot-
  updates the `llm-pi-ai` provider `baseURL` through the dsh settings service,
  no restart needed; the panel shows only the matching section. "Follow
  config" leaves `settings.yaml` untouched.
- **Model usage** (top section) — fed by the console expense-bill APIs, which
  book near-real-time:
  - first row after the month list combines balance (left) with month-to-date
    spend + total tokens (right);
  - "This month" / "Today" sub-sections list per-model tokens and settlement
    amounts, pricing tiers merged, each with a spend total (tokens included);
  - embedded **spend alert**, edited right in the panel:
    - period toggle: this month / today;
    - threshold is a "manual input + preset dropdown" box (10 / 20 / 30 / 50 /
      1M … 1B, thousands separators) plus a unit dropdown (token / ¥) —
      period × unit covers all four metering modes;
    - the "stop calls at threshold" checkbox stays disabled until a threshold
      value is set;
    - once checked and the threshold is crossed, the tab dot turns amber and
      the host parks the call endpoint on a loopback refuse port — new calls
      fail fast at zero cost until the guard is lifted; unchecked, the dot
      never turns amber.
- **Resource packs** — balance / total / progress bar / expiry per pack;
  depleted (0 left) and expired/cancelled packs sink into a collapsed
  "已失效 (inactive)" sub-section.
- **Coding Plan** — 5-hour window, weekly window, monthly MCP lane; a
  **peak/off-peak badge** beside the title (peak = Beijing weekdays
  14:00–18:00 at full deduction, all other times 50%); embedded warn/error
  percent thresholds with colored progress bars.
- **Collapsed tab** — right-edge vertical tab with a status dot: green =
  callable (balance > 0 / data healthy), amber = stop-calls checked and
  threshold crossed (guard active), red = balance exhausted or 5h/weekly
  window used up, gray = unknown. Optionally **draggable** with position
  memory.

## Data sources

Undocumented console endpoints, stable in practice; all accept API Key Bearer
auth (raw-key fallback on 401):

| Endpoint | Purpose |
|---|---|
| `GET {base}/api/monitor/usage/quota/limit` | quota/packs (plain key) and plan windows (coding key) |
| `GET {base}/api/biz/tokenAccounts/list/my` | resource pack list (total / balance / frozen / expiry / status) |
| `GET {base}/api/biz/account/query-customer-account-report` | cash balance (console finance mirror) |
| `GET {base}/api/finance/chartBill/product/{YYYY-MM}` | current-month bill rows per product (tokens + settlement amount) |
| `GET {base}/api/finance/expenseBill/expenseBillList?billingMonth={YYYY-MM}` | line-item bill rows (source for "today"; the by-day view only finalizes yesterday) |

Call-endpoint switching goes through the dsh settings service
(`settings.update("llm-pi-ai", …)` deep-merges `baseURL` only); `llm-pi-ai`
picks it up live.

> **Compatibility** (V1.01 / `1.0.1`): DSH `>= 0.1.5-rc.1` (adapted and tested on `0.1.5-rc.1`).
> From V1.01 the channel's HTTP route is registered by the plugin itself via the
> `webServer` service: `ctx.connection.rpc.handle` throws on DSH `0.1.5-rc.1`
> because the connection plugin's internal `webServer` access lacks the inject,
> so it is no longer used.
>
> | Plugin version | DSH versions |
> |---|---|
> | V1.01 (`1.0.1`) | `>= 0.1.5-rc.1` |
> | V1.0 (`1.0.0`) | `0.1.2-alpha.4` ~ `0.1.2-rc.1` |

## Install

```sh
dsh plugin --profile web add "link:E:/working/dsh-zhipu-balance"
# or: dsh plugin --profile web add "file:E:/working/dsh-zhipu-balance"
```

Credentials go into `$DSH_HOME/.credentials.yaml` (or same-named env vars):

```yaml
ZHIPU_API_KEY: xxxxxxxx.xxxxxxxxxxxxxxxx         # API Key mode (packs / balance / bills)
ZAI_CODING_CN_API_KEY: xxxxxxxx.xxxxxxxxxxxxxxxx # Coding Plan mode (optional)
```

## Configuration (optional)

All keys have defaults; override the panel row config in the profile's
`cordis.patch.yml`:

| Key | Meaning | Default |
|---|---|---|
| `refreshMs` | auto-refresh interval (≥ 5000) | `60000` |
| `apiRefs` | credential refs probed for the API row | `["ZHIPU_API_KEY", "GLM_API_KEY"]` |
| `apiBaseUrl` | upstream base (monitor/bills share it) | `https://open.bigmodel.cn` |
| `codingRefs` | credential refs probed for the coding row | `["ZAI_CODING_CN_API_KEY"]` |
| `codingBaseUrl` | coding plan base (global: `https://api.z.ai`) | `https://open.bigmodel.cn` |
| `usageDetail` | fetch model usage (month/today bills) | `true` |
| `warnPercent` / `errorPercent` | coding-window warn/error thresholds % | `70` / `90` |

Browser-side preferences (call mode, thresholds, fold states, tab position,
white background) live in `localStorage` and stay local to that browser.

## Development

```sh
npm run check   # node --check lib/index.js lib/client.js
```

Host-half changes (`lib/index.js`) need a `dsh web` restart; the client script
(`lib/client.js`) hot-reloads via dsh's built-in HMR.
