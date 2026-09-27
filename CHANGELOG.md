# Changelog

## [2.4.0] - 2026-09-27

### Added
- PHP: optional `config.php` next to `a.php` for your settings (READ_TOKEN, SITE_DOMAIN, STRICT_ORIGIN, DB_FILE) — updating `a.php` no longer means re-entering them. Editing the defaults inside `a.php` still works.
- PHP: records visitor country from Cloudflare's `CF-IPCountry` header when the site is proxied through Cloudflare (was always null).
- AI channel detection from `utm_source` — visits tagged e.g. `?utm_source=chatgpt.com` count as AI even when the assistant strips the referrer.

### Improved
- AI referrer hosts: chat.mistral.ai, meta.ai, duck.ai, chat.qwen.ai, kimi.com, phind.com
- Search hosts: kagi.com, startpage.com, qwant.com, naver.com, seznam.cz
- Social hosts: threads.net, threads.com, lnkd.in, youtu.be, t.me, discord.com, quora.com, substack.com
- Crawler classification: AI crawlers now include OAI-SearchBot, Claude-User/Claude-SearchBot, Perplexity-User, Meta-ExternalFetcher, Amazonbot, CCBot, DuckAssistBot, MistralAI-User; search crawlers now include Applebot, PetalBot, SeznamBot, Yeti (Naver)
- Cloudflare `/stats` runs its queries as a single D1 batch (one round trip instead of eleven)
- Cloudflare: compatibility_date bumped to 2026-09-01; devDependencies bumped (wrangler ^4.141, @cloudflare/workers-types ^5, typescript ^7)
- Snippet v2.4: single-page-app route changes now send the previous in-site URL as the referrer (like a normal page load) instead of repeating the original external referrer

### Fixed
- Viewport width stored consistently: missing/zero/non-numeric values are stored as null in both variants (PHP previously stored 0; Worker accepted non-numbers)
- `/stats?name=,` (empty name list) no longer produces invalid SQL; falls back to the default `pageview`

### Security
- PHP `.htaccess` also blocks HTTP access to `config.php`; PHP README now documents the nginx rule needed to block `analytics.sqlite` and `config.php` (nginx ignores `.htaccess`, so the database was downloadable on nginx hosts)

## [2.3.0] - 2026-06-09

### Added
- Owner opt-out: set `localStorage._wi_exclude` to exclude your own traffic from tracking
- Viewport width now captured alongside UA-based device classification (new `viewport` column)

### Improved
- Better device detection regex (tablet vs mobile vs desktop)
- Social host list expanded

### Database
- Migration `0003_viewport_width.sql` adds `viewport` column to events table

## [2.2.0] - 2026-06-07

### Improved
- Social host list updated with additional platforms

## [2.1.0] - 2026-06-03

### Improved
- Worker ingest hardened with additional validation
- PHP variant aligned with Worker on edge cases

## [2.0.1] - 2026-06-02

### Fixed
- 404 auto-detection improved: snippet now checks `document.title` for "404" or "not found" at the start of the string, avoiding false positives on blog posts like "How to fix 404 errors"
- Outbound link click tracking added to snippet
- Element click tracking via `data-track` attribute

## [2.0.0] - 2026-05-31

### Added
- **Protocol v2** — major feature release
- Referring page capture (`ref_path` column) — not just the hostname, but the full path
- Client-type classification: human, headless, http_client, search_crawler, ai_crawler (derived from UA at ingest; raw UA is never stored)
- Outbound link click tracking (automatic)
- Element click tracking via `data-track` attributes
- Custom event JS API: `window.sa('event', 'name')`
- Consecutive pageview deduplication (form-submit reloads don't double-count)
- SPA support via `history.pushState` and `popstate` interception
- Cloudflare country detection via `CF-IPCountry` header
- `www.` / apex domain normalisation for origin checks
- PHP variant: auto-migration from v1 schema (adds missing columns)
- `UPDATING.md` — user-facing update instructions
- `PROTOCOL.md` — full wire protocol specification

### Database
- Migration `0002_richer_events.sql` adds `ref_path` and `client_type` columns

## [1.0.0] - 2026-05-30

### Added
- Initial release
- Cloudflare Worker + D1 variant
- PHP + SQLite variant for shared hosting
- Cookieless visitor tracking via daily-rotating salted SHA-256 hash
- Pageview and custom event ingest
- Referrer classification: direct, search, social, AI assistant, referral
- AI channel detection (ChatGPT, Claude, Perplexity, Gemini, Copilot, etc.)
- UTM campaign parameter capture
- Device classification (mobile, tablet, desktop)
- Spam/fake traffic flagging with Origin/Referer checks
- Token-authenticated read API with date range, channel, device, and name filters
- Raw event export with cursor pagination
- One-click Deploy to Cloudflare button
