# Wire Protocol v1

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
  "n": "pageview",                 // event name: "pageview" or a custom string
  "d": "example.com",              // document hostname
  "u": "/blog/post?utm_source=x",  // path + query
  "r": "https://chatgpt.com/",     // referrer (or null)
  "w": 1280                        // viewport width (for device class)
}
```

- **Response**: `202 Accepted`, empty body. Always 202 even on soft-reject (bot, bad
  domain) so the client never retries or leaks validation detail.

The **client IP and User-Agent are never stored**. They are read from the request
only to compute the daily visitor hash (see below), then discarded.

---

## `GET /stats` — read aggregates (authenticated)

- **Auth**: `Authorization: Bearer <READ_TOKEN>` (read-only token the owner sets).
- **Query**:
  - `from=YYYY-MM-DD&to=YYYY-MM-DD` (default: last 30 days).
  - `include_flagged=1` — include suspected bot/spam traffic (default: excluded).
- **Response**:

```json
{
  "range": { "from": "2026-05-01", "to": "2026-05-30" },
  "totals": { "pageviews": 3110, "visitors": 1240 },
  "timeseries": [ { "day": "2026-05-01", "pageviews": 88, "visitors": 51 } ],
  "pages":      [ { "path": "/", "pageviews": 900, "visitors": 620 } ],
  "referrers":  [ { "ref_host": "chatgpt.com", "visitors": 210 } ],
  "channels":   [ { "channel": "ai", "visitors": 210 } ],
  "devices":    [ { "device": "desktop", "visitors": 700 } ],
  "flagged":    { "total": 42, "excluded": true,
                  "reasons": [ { "flags": "origin_mismatch", "count": 30 },
                               { "flags": "bot", "count": 12 } ] }
}
```

`channel` is one of: `ai`, `search`, `social`, `referral`, `direct`.

By default the counts above **exclude flagged traffic**; `flagged` reports how much
was held back and why, so a dashboard can show "42 hits flagged — [review] / [include]".

---

## `GET /events` — raw export (authenticated)

For dashboards that want to re-aggregate locally / keep a local backup.

- **Auth**: Bearer token.
- **Query**: `since=<event id cursor>&limit=<=1000` (default 0 / 500).
- **Response**: `{ "events": [ {row...} ], "next": <cursor|null> }`.

---

## `GET /meta` — capabilities (public)

Lets the dashboard validate a connection during "Add site".

```json
{ "protocol": 1, "domain": "example.com", "engine": "cloudflare-d1" }
```

---

## `GET /a.js` — serve the tracking snippet

Returns the JS in `snippet/a.js` with `Content-Type: text/javascript`.

---

## Cookieless visitor identity

Each collector computes, per event:

```
visitor = SHA256( daily_salt + domain + client_ip + user_agent )
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
  - `bot` — User-Agent matched a known-bot pattern.
  - `no_origin` — no `Origin`/`Referer` header (typical of `curl`/scripts). *Only
    evaluated when `SITE_DOMAIN` is set.*
  - `origin_mismatch` — `Origin`/`Referer` host ≠ `SITE_DOMAIN`.
- **Strict mode** (`STRICT_ORIGIN`): flagged events are dropped at ingest instead of
  stored.
- **Visitor-count protection:** because the visitor hash folds in IP+UA, a flood from
  one source collapses to ~1 visitor — raw pageviews can be inflated, uniques far less.
- The **dashboard** is the backstop: it surfaces the `flagged` summary, can flag volume
  anomalies, and lets the user include/exclude suspect traffic from reports.

> A determined attacker who spoofs `Origin` and rotates IPs can still inflate pageview
> counts — true of every analytics tool. Rate-limiting (e.g. Cloudflare rules) and
> dashboard-side anomaly review are the mitigations, not prevention.
