# Wire Protocol v2

This is the contract every collector implementation (Cloudflare Worker, PHP) honours,
and the contract the dashboard app reads against. Keep it backwards-compatible.

All endpoints are mounted under a base path the site owner controls, e.g.
`https://example.com/_a` or `https://stats.example.com`. The snippet's `data-host`
points at that base. Paths below are relative to the base.

---

## `POST /event` — ingest (public)

Called by the tracking snippet on every pageview / custom event.

- **Body**: a JSON string (sent as `text/plain` so `navigator.sendBeacon` issues a
  CORS-simple request with no preflight).

```json
{
  "n": "pageview",                 // event name: "pageview", "404", or a custom string
  "d": "example.com",              // document hostname
  "u": "/blog/post?utm_source=x",  // path + query
  "r": "https://chatgpt.com/",     // referrer (or null)
  "w": 1280                        // viewport width (for device class)
}
```

The snippet **auto-detects 404 pages** by checking `document.title` for "404" or
"not found" — no manual configuration needed. It sends `"n": "404"` for those hits,
which are excluded from pageview counts by default and surfaced in the Broken Links
view. Manual overrides: `window.__tc_event = "404"` or `data-event="404"` on the
script tag.

- **Response**: `202 Accepted`, empty body. Always 202 even on soft-reject (bot, bad
  domain) so the client never retries or leaks validation detail.

**Stored per event** (the raw IP and User-Agent are never stored):

| Field | Description |
|---|---|
| `ts` | Unix epoch (ms) |
| `name` | `pageview`, `404`, or a custom event name |
| `domain` | The page's hostname |
| `path` | URL path + query |
| `visitor` | Daily-rotating cookieless hash (see below) |
| `ref_host` | Referrer hostname (null if direct) |
| `ref_path` | Referrer path (v2 — for "referring pages" views) |
| `channel` | `ai` / `search` / `social` / `referral` / `direct` |
| `client_type` | `human` / `headless` / `http_client` / `search_crawler` / `ai_crawler` (v2 — derived from UA at ingest, UA itself not stored) |
| `utm_source`, `utm_medium`, `utm_campaign` | Parsed from the page URL |
| `device` | `mobile` / `tablet` / `desktop` |
| `country` | From Cloudflare `CF-IPCountry` header (null on PHP) |
| `flags` | Null if clean; else comma-joined reasons (`bot`, `no_origin`, `origin_mismatch`) |

---

## `GET /stats` — read aggregates (authenticated)

- **Auth**: `Authorization: Bearer <READ_TOKEN>` (read-only token the owner sets).
- **Query**:
  - `from=YYYY-MM-DD&to=YYYY-MM-DD` (default: last 30 days).
  - `include_flagged=1` — include suspected bot/spam traffic (default: excluded).
  - `channel=ai` — filter by channel (v2).
  - `client_type=human` — filter by client type (v2).
  - `device=desktop` — filter by device (v2).
  - `name=pageview` — filter by event name; `all` = any (v2, default: `pageview`).
- **Response**:

```json
{
  "range": { "from": "2026-05-01", "to": "2026-05-30" },
  "totals": { "pageviews": 3110, "visitors": 1240 },
  "timeseries": [ { "day": "2026-05-01", "pageviews": 88, "visitors": 51 } ],
  "pages":      [ { "path": "/", "pageviews": 900, "visitors": 620 } ],
  "referrers":  [ { "ref_host": "chatgpt.com", "ref_path": "/", "visitors": 210 } ],
  "channels":   [ { "channel": "ai", "visitors": 210 } ],
  "devices":    [ { "device": "desktop", "visitors": 700 } ],
  "clientTypes":[ { "client_type": "human", "visitors": 1200 } ],
  "notFound":   [ { "path": "/old-page", "ref_host": "google.com", "ref_path": "/search", "count": 5 } ],
  "flagged":    { "total": 42, "excluded": true,
                  "reasons": [ { "flags": "origin_mismatch", "count": 30 },
                               { "flags": "bot", "count": 12 } ] }
}
```

`channel` is one of: `ai`, `search`, `social`, `referral`, `direct`.

`client_type` is one of: `human`, `headless`, `http_client`, `search_crawler`,
`ai_crawler`.

By default the counts above **exclude flagged traffic and 404s**; `flagged` reports
how much was held back; `notFound` lists the 404 paths with their referrers.

---

## `GET /events` — raw export (authenticated)

For dashboards that reconstruct sessions / journeys locally, or keep a local backup.

- **Auth**: Bearer token.
- **Query**:
  - `from=YYYY-MM-DD&to=YYYY-MM-DD` (default: last 30 days) — v2.
  - `since=<event id cursor>&limit=<=1000` (default 0 / 500).
  - `include_flagged=1` — include flagged events (v2).
- **Response**: `{ "events": [ {row...} ], "next": <cursor|null> }`.

Each event includes all stored fields (see the table above).

---

## `GET /meta` — capabilities (public)

Lets the dashboard validate a connection during "Add site".

```json
{ "protocol": 2, "domain": "example.com", "engine": "cloudflare-d1" }
```

---

## `GET /a.js` — serve the tracking snippet

Returns the tracking snippet with `Content-Type: text/javascript`. The snippet is
served by the Worker itself (not a separate file), so it updates automatically on
redeploy.

---

## Cookieless visitor identity

Each collector computes, per event:

```
visitor = SHA256( daily_salt + domain + client_ip + user_agent + accept_language )
```

`daily_salt` is random, rotated every 24h, and only today's + yesterday's salts are
retained. This yields stable within-day uniques with no cookies and no cross-day
linkability. The same person on two different days counts as two uniques — an
accepted privacy trade-off (the Plausible model).

---

## Spam / fake-traffic handling

The ingest endpoint is necessarily public (browsers post to it with no auth), so it
**cannot** be made private. Defense is layered, and the model is **tag, don't silently
drop**, so the owner can see and decide:

- **Always dropped (never stored):** malformed payloads, and events whose `d` doesn't
  match the configured `SITE_DOMAIN`.
- **Flagged** (stored with a `flags` reason, excluded from reports by default):
  - `bot` — User-Agent matched a known-bot pattern (v2: expanded to include curl,
    wget, python-requests, postman, and other HTTP clients).
  - `no_origin` — no `Origin`/`Referer` header (typical of `curl`/scripts). *Only
    evaluated when `SITE_DOMAIN` is set.*
  - `origin_mismatch` — `Origin`/`Referer` host ≠ `SITE_DOMAIN`.
- **Client-type classification** (v2): the User-Agent is classified at ingest into
  `human`, `headless`, `http_client`, `search_crawler`, or `ai_crawler` — the raw UA
  is **not stored**, preserving privacy while enabling viewer-type filtering.
- **Strict mode** (`STRICT_ORIGIN`): flagged events are dropped at ingest instead of
  stored.
- **Visitor-count protection:** because the visitor hash folds in IP+UA, a flood from
  one source collapses to ~1 visitor — raw pageviews can be inflated, uniques far less.
- The **dashboard** is the backstop: it surfaces the `flagged` summary, can flag volume
  anomalies, and lets the user include/exclude suspect traffic from reports.

> A determined attacker who spoofs `Origin` and rotates IPs can still inflate pageview
> counts — true of every analytics tool. Rate-limiting (e.g. Cloudflare rules) and
> dashboard-side anomaly review are the mitigations, not prevention.

---

## Changelog

### v2.2 (2026-06-07)
- Accept-Language added to visitor hash for better accuracy on shared IPs.
- Host matching rewritten with domain-boundary checks (`t.co` no longer
  false-matches `producthunt.com`; `mastodon.` now matches Mastodon instances).
- Removed non-functional `bing.com/chat` from AI_HOSTS (hostMatches only sees
  hostnames, not paths).
- Outbound link click tracking + `data-track` element click tracking in snippet.
- Consecutive pageview deduplication in snippet (form-submit reloads).
- Tighter 404 auto-detection (`^404` / `^(page )?not found` — won't false-positive
  on blog posts about 404s).
- www normalisation: `SITE_DOMAIN` accepts either `example.com` or
  `www.example.com` — both work regardless of redirect setup.
- Comma-separated `name` filter support (`name=pageview,404`).
- `/stats` returns `countries` breakdown (Cloudflare + PHP).
- POST body size capped at 2KB.
- PHP variant checks `CF-Connecting-IP` first for sites behind Cloudflare.
- Snippet version updated to v2.2.

### v2 (2026-05-31)
- Added `ref_path` (full referrer path) for referring-page views.
- Added `client_type` (human/headless/http_client/search_crawler/ai_crawler), derived
  from UA at ingest without storing the raw UA.
- Auto-detects 404 pages (snippet checks `document.title`); 404 events are excluded
  from pageview counts and surfaced in `notFound`.
- `/stats` now supports `channel`, `client_type`, `device`, `name` filter params.
- `/stats` returns `clientTypes` and `notFound` breakdowns.
- `/events` is now date-bounded (`from`/`to`) and supports `include_flagged`.
- Expanded bot-UA detection to cover curl, wget, python-requests, postman, etc.

### v1 (2026-05-30)
- Initial release: cookieless ingest, AI-channel classification, spam flagging,
  token-auth read API, pageview/referrer/channel/device/UTM tracking.
