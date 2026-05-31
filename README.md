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

Pageviews, unique visitors, referrers with **referring pages**, an **AI-assistant
channel** (ChatGPT, Claude, Perplexity, Gemini…), UTM campaigns, device class,
**client type** (human / bot / crawler — classified without storing the raw
User-Agent), **automatic 404 detection** (broken-link visibility), and custom
events (`window.sa('event', 'signup')`). See [PROTOCOL.md](PROTOCOL.md).

## Updating your collector

See [UPDATING.md](UPDATING.md) — download the latest ZIP, upload the folders to
your repo via GitHub's web UI (drag and drop), commit. No terminal needed. Your
data, tokens, and settings are preserved across updates.

## Quick start — Cloudflare (recommended)

### One-click deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/davettt/analytics-collector/tree/main/cloudflare)

Clicking the button clones this repo into your own GitHub account and deploys the
Worker to your own Cloudflare account. On the setup screen:

- **D1 database** — leave **Create new**; it's auto-provisioned and the schema
  migration runs automatically on deploy (`npm run deploy`).
- **SITE_DOMAIN** — your site's hostname, e.g. `example.com` (enables spam filtering).
- **STRICT_ORIGIN** — `false` (default) flags suspect traffic; `true` drops it.

After it deploys:

1. **Set the read token (secret):** Worker → Settings → Variables and Secrets → add a
   **secret** named `READ_TOKEN` (a long random string). Read endpoints return `503`
   until it's set. **Save this token** — your dashboard app needs it.
2. **Put it on your own domain** so the snippet is first-party. Add a Worker
   **Custom Domain** like `stats.example.com` (simplest), or a route `example.com/_a/*`
   for same-origin. Then add the snippet to your pages:
   ```html
   <script defer src="https://stats.example.com/a.js" data-host="https://stats.example.com"></script>
   ```

> If you've restricted the Cloudflare GitHub App to "only select repositories," the
> deploy will prompt you to let it create the new repo.

### Manual deploy (alternative)

```bash
cd cloudflare
npm install
npx wrangler login
npx wrangler d1 create analytics-collector-db   # paste the database_id into wrangler.jsonc
npm run deploy                                   # runs migrations + deploys
npx wrangler secret put READ_TOKEN              # set a long random read token
```

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

**v2** (protocol version 2). The **Cloudflare variant is deployed and verified
end-to-end** — one-click deploy, auto-provisioned D1, automatic migrations,
cookieless ingest, AI-channel classification, client-type classification, auto-404
detection, referring-page capture, token-auth read API with cross-filters, and
Origin-based spam flagging. The **PHP variant** implements the same protocol but is
not yet updated to v2. Not load-tested at scale. MIT licensed.
