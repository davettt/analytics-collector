# analytics-collector

Privacy-first, **owner-hosted** web analytics. The tracking snippet and the data
both live on **your own hosting** — nothing is sent to a third party. A separate
desktop dashboard app reads your stats directly from your collector via a
token-authenticated API.

- **Cookieless** — no cookies, no localStorage, no persistent IDs. Visitor uniqueness
  uses a daily-rotating salted hash (`SHA256(daily_salt + domain + IP + UA)`); the IP
  and User-Agent are never stored.
- **Your data, your server** — no central service in the data path.
- **Two ways to run it**, one shared [wire protocol](PROTOCOL.md):

| Variant | For | Storage | Setup |
|---|---|---|---|
| [`cloudflare/`](cloudflare/) | Cloudflare sites / static hosts | D1 (managed SQLite) | Deploy button or `wrangler` |
| [`php/`](php/) | Shared hosting (cPanel, WordPress hosts) | SQLite file | Upload 1 file + `.htaccess` |

## What it captures

Pageviews, unique visitors, referrers (with an **AI-assistant channel** —
ChatGPT, Claude, Perplexity, Gemini…), UTM campaigns, device class, and custom
events (`window.sa('event', 'signup')`). See [PROTOCOL.md](PROTOCOL.md).

## Quick start — Cloudflare (recommended)

> Replace `<...>` placeholders. Requires a free Cloudflare account.

```bash
cd cloudflare
npm install
npx wrangler login
npx wrangler d1 create analytics-collector-db   # paste the database_id into wrangler.jsonc
npm run deploy                                   # runs migrations + deploys
npx wrangler secret put READ_TOKEN              # set a long random read token
```

Then bind the Worker to a route on your own domain so the snippet is same-origin
(e.g. `yoursite.com/_a/*` — uncomment `routes` in `wrangler.jsonc`), and add to
your pages:

```html
<script defer src="https://yoursite.com/_a/a.js" data-host="https://yoursite.com/_a"></script>
```

A one-click **Deploy to Cloudflare** button (auto-provisions D1) will live here
once the repo is pushed to GitHub.

## Quick start — shared hosting

See [`php/README.md`](php/README.md): upload `a.php` + `.htaccess`, set a token, add the snippet.

## Spam & fake traffic

The ingest endpoint must be public (every visitor's browser posts to it), so it can't
be locked down — but the collector filters and **flags** suspect traffic rather than
trusting everything. See [PROTOCOL.md](PROTOCOL.md#spam--fake-traffic-handling) for the
full model. To turn it on:

1. Set **`SITE_DOMAIN`** to your hostname (Worker: `wrangler.jsonc` vars / dashboard;
   PHP: top of `a.php`). This enables `Origin`/`Referer` checks and drops events
   claiming a different site.
2. Optionally set **`STRICT_ORIGIN`** to drop suspect traffic outright instead of
   storing it tagged.
3. **Cloudflare variant — add a rate-limit rule** (Dashboard → your Worker/zone →
   Security → Rate limiting): e.g. *path contains `/_a/event` → more than `20`
   requests per `10s` from one IP → Block (or Managed Challenge)*. This stops floods
   with zero code, on top of Cloudflare's built-in WAF/bot/DDoS protection.

> Because suspect traffic is **flagged, not deleted**, `/stats` excludes it by default
> and reports how much was held back — the dashboard shows it and lets you include or
> discard it per report.

## Reading your data

Any client that speaks the [protocol](PROTOCOL.md) can read your stats with the
Bearer token, e.g.:

```bash
curl -H "Authorization: Bearer <READ_TOKEN>" "https://yoursite.com/_a/stats?from=2026-05-01&to=2026-05-30"
```

The companion **Tiong Creative analytics dashboard** (a macOS app, sold
separately) is the polished way to view one or many sites at once.

## Status

v1 scaffold. Cloudflare variant is the primary target; PHP variant implements the
same protocol. Not yet load-tested. MIT licensed.
