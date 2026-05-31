# PHP + SQLite collector

For traditional shared hosting (cPanel, self-hosted WordPress hosts). Data is
stored in a flat SQLite file — **it does not touch your MySQL database.**

## Install (Apache / LiteSpeed)

1. Create a folder on your site, e.g. `/_a/`.
2. Upload **`a.php`** and **`.htaccess`** into it.
3. Open `a.php` and set `READ_TOKEN` to a long random string (this is what your
   dashboard app uses to read stats). Optionally set `SITE_DOMAIN`.
4. Add the snippet to your site's pages:
   ```html
   <script defer src="https://yoursite.com/_a/a.js" data-host="https://yoursite.com/_a"></script>
   ```

That's it. `analytics.sqlite` is created automatically on the first pageview.

## nginx hosts

nginx doesn't read `.htaccess`. Either:
- add a location block mapping `/_a/(event|stats|events|meta|a.js)` to `a.php`, or
- point `data-host` straight at the script and use query routing:
  `data-host="https://yoursite.com/_a/a.php?e"` is **not** supported by the shared
  snippet — instead add a tiny nginx rewrite, or use the Cloudflare variant.

## Updating

1. Download the latest `a.php` from the `php/` folder in the
   [source repo](https://github.com/davettt/analytics-collector).
2. Upload it to the same location on your hosting, replacing the old file.
3. **Re-enter your `READ_TOKEN` and `SITE_DOMAIN`** at the top of the new file (the
   download ships with placeholder values).

That's it. The new `a.php` automatically adds any missing database columns on the
first request — your existing data is preserved. The tracking snippet is served by
the script itself, so your site picks up the updated snippet automatically (no HTML
changes needed).

## Notes & limits

- **Requires PHP 7.4+ with PDO SQLite** (standard on virtually all PHP hosts).
- SQLite WAL mode does **not** work on NFS-mounted home dirs (rare on budget hosts).
  If you see locking errors, move the folder off any NFS path.
- Best for sites up to tens of thousands of pageviews/day. For higher volume use a
  real database or the Cloudflare variant.
- Always serve over **HTTPS** — the read token travels in a header.
