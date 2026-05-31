# Updating your collector

When a new version of the collector is released, your deployed copy doesn't update
automatically. Here's how to get the latest version — no terminal or git knowledge
required.

---

## Cloudflare variant

### 1. Download the latest version

Go to [github.com/davettt/analytics-collector](https://github.com/davettt/analytics-collector),
click **Code → Download ZIP**, and unzip the downloaded file on your computer.

### 2. Open the `cloudflare/` folder from the download

Inside the unzipped folder you'll see several subfolders (`cloudflare/`, `php/`,
`snippet/`, etc.). Open the **`cloudflare/`** folder — the files inside it are what
your repo contains.

> **Important:** upload the *contents* of `cloudflare/` (the files and folders inside
> it), not the `cloudflare/` folder itself. Your repo's root should have `src/`,
> `migrations/`, `package.json`, etc. directly — not nested inside a `cloudflare/`
> subfolder.

### 3. Upload to your repo

- Go to **your** repository on GitHub (the one Cloudflare created when you deployed).
- Click **Add file → Upload files**.
- Drag and drop everything from inside the `cloudflare/` folder (i.e. `src/`,
  `migrations/`, `package.json`, `tsconfig.json`, `wrangler.jsonc`) into the upload
  area. Files with the same name are replaced automatically.
- Write a commit message (e.g. "Update collector to latest version") and click
  **Commit changes**.

### 4. That's it

Your Cloudflare Worker **auto-deploys** on every commit. The deploy step runs any
new database migrations automatically (e.g. adding new columns), so your existing
data is preserved and the schema is updated.

### What stays the same across updates

- **Your tracking snippet** — you don't need to change anything on your website. The
  snippet (`a.js`) is served by the Worker itself, so it updates automatically when
  the Worker redeploys.
- **Your READ_TOKEN and settings** — secrets and environment variables are stored in
  Cloudflare, not in the repo. Uploading new files doesn't affect them.
- **Your data** — migrations only add new capabilities (new columns, etc.). They never
  delete existing data.

### Alternative: command line

If you're comfortable with git, you can download just the `cloudflare/` contents
directly into your repo:

```bash
cd YOUR-REPO-NAME

# Download the latest cloudflare/ contents as an archive, extract into your repo root
curl -sL https://github.com/davettt/analytics-collector/archive/refs/heads/main.tar.gz \
  | tar -xz --strip-components=2 analytics-collector-main/cloudflare/

# Commit and push — auto-deploys
git add -A
git commit -m "Update collector to latest version"
git push
```

> Your deploy repo contains the *contents* of `cloudflare/` at its root — not the
> full source repo. The command above extracts only that subfolder, so your repo
> structure stays correct.

---

## PHP variant

### 1. Download the latest version

Same as above — download the ZIP from
[github.com/davettt/analytics-collector](https://github.com/davettt/analytics-collector)
and unzip it.

### 2. Upload the new files

Open the **`php/`** folder from the download. Upload the new `a.php` to the same
location on your hosting (e.g. `/_a/a.php`), replacing the old file. Also replace
`.htaccess` if it changed.

> **Important:** your `READ_TOKEN` and `SITE_DOMAIN` are set at the top of `a.php`.
> After uploading the new file, **re-enter your token and domain** in the config
> section at the top — the new file ships with placeholder values.

### 3. Database update

The new `a.php` automatically adds any missing columns to your SQLite database on
the first request after the update. Your existing data is preserved.

### What about the tracking snippet?

The PHP collector also serves the snippet (`a.js`) from the script itself, so your
site picks up the updated snippet automatically — **no HTML changes needed**.
