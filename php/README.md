# PHP + SQLite collector

For traditional shared hosting (cPanel, self-hosted WordPress hosts). Data is
stored in a flat SQLite file — **it does not touch your MySQL database.**

## Install (Apache / LiteSpeed)

1. Create a folder on your site, e.g. `/_a/` (any name works — use it in place of
   `_a` in the steps below).
2. Upload **`a.php`** and **`.htaccess`** into it.
3. Create a file named **`config.php`** in the same folder with your settings:
   ```php
   <?php
   define('READ_TOKEN', 'a-long-random-string'); // what your dashboard app uses to read stats
   define('SITE_DOMAIN', 'yoursite.com');        // optional; enables spam filtering
   ```
   Keeping settings in `config.php` means updating `a.php` never overwrites them.
   (Editing the values at the top of `a.php` also works, but you'd redo it on every update.)
4. Add the snippet to your site's pages:
   ```html
   <script defer src="https://yoursite.com/_a/a.js" data-host="https://yoursite.com/_a"></script>
   ```

That's it. `analytics.sqlite` is created automatically on the first pageview.

## nginx hosts

nginx doesn't read `.htaccess`, so **you must block the data file and config
yourself** — otherwise anyone can download `analytics.sqlite`:

Change `_a` to your folder name if different:

```nginx
location ~ ^/_a/(.*\.sqlite(-wal|-shm)?|config\.php)$ { deny all; }
```

For routing, either:
- add a location block mapping `/_a/(event|stats|events|meta|a.js)` to `a.php`, or
- point `data-host` straight at the script and use query routing:
  `data-host="https://yoursite.com/_a/a.php?e"` is **not** supported by the shared
  snippet — instead add a tiny nginx rewrite, or use the Cloudflare variant.

## Updating

1. Download the latest `a.php` from the `php/` folder in the
   [source repo](https://github.com/davettt/analytics-collector).
2. Upload it to the same location on your hosting, replacing the old file.
3. If your settings are in `config.php`, you're done — leave it in place. If you
   set them at the top of the old `a.php` instead, re-enter them in the new file
   (or move them into `config.php` now so future updates are just steps 1–2).

That's it. The new `a.php` automatically adds any missing database columns on the
first request — your existing data is preserved. The tracking snippet is served by
the script itself, so your site picks up the updated snippet automatically (no HTML
changes needed).

## Notes & limits

- **Requires PHP 7.4+ with PDO SQLite** (standard on virtually all PHP hosts). PHP 8.1+
  recommended — older versions no longer get security fixes.
- SQLite WAL mode does **not** work on NFS-mounted home dirs (rare on budget hosts).
  If you see locking errors, move the folder off any NFS path.
- Best for sites up to tens of thousands of pageviews/day. For higher volume use a
  real database or the Cloudflare variant.
- Always serve over **HTTPS** — the read token travels in a header.
