/**
 * analytics-collector — Cloudflare Worker variant
 *
 * Mount on a route on the owner's own domain, e.g. `example.com/_a/*`, so the
 * snippet POSTs same-origin. Stores events in D1 (managed SQLite). Cookieless.
 *
 * Endpoints (matched by path suffix, so the mount base can be anything):
 *   POST .../event   ingest (public)
 *   GET  .../stats   aggregates (Bearer READ_TOKEN)
 *   GET  .../events  raw export (Bearer READ_TOKEN)
 *   GET  .../meta    capabilities (public)
 *   GET  .../a.js    serve the tracking snippet
 */

export interface Env {
  DB: D1Database;
  READ_TOKEN?: string; // set via `wrangler secret put READ_TOKEN` or dashboard
  SITE_DOMAIN?: string; // optional: expected hostname. Enables Origin/Referer checks.
  STRICT_ORIGIN?: string; // "true" = drop suspect traffic; default (lenient) = store + flag
}

const PROTOCOL_VERSION = 2;

// Minimal referrer classification. The dashboard can re-classify from raw events,
// so this list only needs to be "good enough" and can grow over time.
const AI_HOSTS = [
  "chatgpt.com", "chat.openai.com", "claude.ai", "perplexity.ai",
  "gemini.google.com", "copilot.microsoft.com",
  "deepseek.com", "grok.com", "x.ai", "you.com", "poe.com",
  "chat.mistral.ai", "meta.ai", "duck.ai", "chat.qwen.ai", "kimi.com", "phind.com"
];
const SEARCH_HOSTS = ["google.", "bing.com", "duckduckgo.com", "ecosia.org", "search.brave.com", "yahoo.com", "baidu.com", "yandex.", "kagi.com", "startpage.com", "qwant.com", "naver.com", "seznam.cz"];
const SOCIAL_HOSTS = ["facebook.com", "instagram.com", "t.co", "twitter.com", "x.com", "linkedin.com", "lnkd.in", "reddit.com", "youtube.com", "youtu.be", "news.ycombinator.com", "mastodon.", "bsky.app", "pinterest.", "tiktok.com", "threads.net", "threads.com", "t.me", "discord.com", "quora.com", "substack.com"];

const BOT_UA = /bot|crawl|spider|slurp|headless|preview|monitor|lighthouse|pingdom|gtmetrix|curl|wget|python-requests|python-urllib|go-http-client|okhttp|java\/|libwww|httpie|postman|insomnia|node-fetch|axios|undici/i;
const SEARCH_CRAWLER_UA = /googlebot|bingbot|yandexbot|baiduspider|duckduckbot|slurp|sogou|applebot|petalbot|seznambot|yeti/i;
const AI_CRAWLER_UA = /gptbot|chatgpt|oai-searchbot|claudebot|claude-|anthropic|perplexitybot|perplexity-user|bytespider|cohere-ai|meta-externalagent|meta-externalfetcher|amazonbot|ccbot|duckassistbot|mistralai-user/i;
const HEADLESS_UA = /headless|phantomjs|selenium|puppeteer|playwright/i;
const HTTP_CLIENT_UA = /curl|wget|python-requests|python-urllib|go-http-client|okhttp|java\/|libwww|httpie|postman|insomnia|node-fetch|axios|undici/i;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const p = url.pathname;

    if (p.endsWith("/a.js")) return serveSnippet();
    if (p.endsWith("/meta")) return json({ protocol: PROTOCOL_VERSION, domain: env.SITE_DOMAIN ?? null, engine: "cloudflare-d1" });
    if (p.endsWith("/event")) {
      if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
      return ingest(request, env);
    }
    if (p.endsWith("/stats")) return readStats(request, env, url);
    if (p.endsWith("/events")) return readRaw(request, env, url);

    return new Response("Not found", { status: 404 });
  }
};

/* ---------------------------------- ingest --------------------------------- */

async function ingest(request: Request, env: Env): Promise<Response> {
  // Always 202 so the client never retries or learns why something was dropped.
  const ok = new Response(null, { status: 202, headers: { "Access-Control-Allow-Origin": "*" } });
  try {
    const strict = env.STRICT_ORIGIN === "true";
    const ua = request.headers.get("User-Agent") || "";

    const buf = await request.arrayBuffer();
    if (buf.byteLength > 2048) return ok;
    const raw = new TextDecoder().decode(buf);
    const ev = JSON.parse(raw) as { n?: string; d?: string; u?: string; r?: string | null; w?: number };
    if (!ev || !ev.d || !ev.u) return ok; // malformed → always dropped
    const evDomain = ev.d.replace(/^www\./, "");
    const siteDomain = (env.SITE_DOMAIN || "").replace(/^www\./, "");
    if (siteDomain && evDomain !== siteDomain) return ok; // wrong site → always dropped

    // Collect soft-suspicion flags. In strict mode any flag → drop; otherwise we
    // store the event tagged, so the dashboard can surface and exclude it.
    const flags: string[] = [];
    if (BOT_UA.test(ua)) flags.push("bot");

    if (siteDomain) {
      // Browsers attach Origin to every POST and it can't be spoofed from page JS
      // on another origin. curl/scripts usually send neither Origin nor Referer.
      // hostnameOf already strips www., and siteDomain is also stripped above.
      const originHost = hostnameOf(request.headers.get("Origin")) || hostnameOf(request.headers.get("Referer"));
      if (!originHost) flags.push("no_origin");
      else if (originHost !== siteDomain) flags.push("origin_mismatch");
    }

    if (strict && flags.length) return ok; // drop, don't store
    const flagStr = flags.length ? flags.join(",") : null;

    const ip = request.headers.get("CF-Connecting-IP") || "";
    const lang = request.headers.get("Accept-Language") || "";
    const salt = await getDailySalt(env);
    // Normalised domain, so www.example.com and example.com count as one visitor.
    const visitor = await sha256(salt + evDomain + ip + ua + lang);

    const refHost = hostnameOf(ev.r);
    const refPath = pathOf(ev.r);
    const utm = parseUtm(ev.u);
    const channel = classify(refHost, utm.source);
    const clientType = classifyClient(ua);
    const device = deviceClass(ua);
    const country = request.headers.get("CF-IPCountry") || null;
    const viewport = typeof ev.w === "number" && ev.w > 0 ? Math.min(Math.round(ev.w), 100000) : null;

    await env.DB.prepare(
      `INSERT INTO events (ts, name, domain, path, visitor, ref_host, ref_path, channel, utm_source, utm_medium, utm_campaign, device, country, flags, client_type, viewport)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      Date.now(),
      (ev.n || "pageview").slice(0, 80),
      ev.d.slice(0, 255),
      ev.u.slice(0, 1024),
      visitor,
      refHost,
      refPath,
      channel,
      utm.source, utm.medium, utm.campaign,
      device,
      country,
      flagStr,
      clientType,
      viewport
    ).run();
  } catch (e) {
    /* swallow — never surface ingest errors to visitors */
  }
  return ok;
}

/* ----------------------------------- read ---------------------------------- */

async function readStats(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = requireToken(request, env);
  if (auth) return auth;

  const { from, to, fromTs, toTs } = dateRange(url);
  const includeFlagged = url.searchParams.get("include_flagged") === "1";
  const channelFilter = url.searchParams.get("channel"); // e.g. "ai", "search"
  const nameFilter = url.searchParams.get("name") || "pageview"; // default to pageview; "all" = any
  const clientTypeFilter = url.searchParams.get("client_type"); // e.g. "human"
  const deviceFilter = url.searchParams.get("device"); // e.g. "desktop"

  // Build dynamic WHERE clause fragments + bind values
  let f = "";
  const extras: (string | number)[] = [];
  if (!includeFlagged) f += " AND flags IS NULL";
  if (channelFilter) { f += " AND channel = ?"; extras.push(channelFilter); }
  if (nameFilter !== "all") {
    const parsed = nameFilter.split(",").map((n) => n.trim()).filter(Boolean);
    const names = parsed.length ? parsed : ["pageview"]; // e.g. "name=," → default, not invalid SQL
    f += ` AND name IN (${names.map(() => "?").join(",")})`;
    extras.push(...names);
  }
  if (clientTypeFilter) { f += " AND client_type = ?"; extras.push(clientTypeFilter); }
  if (deviceFilter) { f += " AND device = ?"; extras.push(deviceFilter); }

  // Helper: run a query with the base time params + dynamic extras.
  const q = (sql: string, extraBinds: (string | number)[] = []) =>
    env.DB.prepare(sql).bind(fromTs, toTs, ...extras, ...extraBinds);

  const base = `FROM events WHERE ts >= ? AND ts < ?` + f;

  // 404s — events with name='404', counted separately regardless of the name filter.
  const notFoundBase = `FROM events WHERE ts >= ? AND ts < ?` + (includeFlagged ? "" : " AND flags IS NULL") + ` AND name = '404'`;

  // One round trip to D1 instead of eleven.
  const [totalsR, timeseriesR, pagesR, referrersR, channelsR, devicesR, clientTypesR, countriesR, notFoundR, flaggedTotalR, flaggedReasonsR] =
    await env.DB.batch([
      q(`SELECT COUNT(*) AS pageviews, COUNT(DISTINCT visitor) AS visitors ${base}`),
      q(`SELECT date(ts/1000, 'unixepoch') AS day, COUNT(*) AS pageviews, COUNT(DISTINCT visitor) AS visitors ${base} GROUP BY day ORDER BY day`),
      q(`SELECT path, COUNT(*) AS pageviews, COUNT(DISTINCT visitor) AS visitors ${base} GROUP BY path ORDER BY pageviews DESC LIMIT 100`),
      q(`SELECT ref_host, ref_path, COUNT(DISTINCT visitor) AS visitors ${base} AND ref_host IS NOT NULL GROUP BY ref_host, ref_path ORDER BY visitors DESC LIMIT 100`),
      q(`SELECT channel, COUNT(DISTINCT visitor) AS visitors ${base} GROUP BY channel ORDER BY visitors DESC`),
      q(`SELECT device, COUNT(DISTINCT visitor) AS visitors ${base} GROUP BY device ORDER BY visitors DESC`),
      q(`SELECT client_type, COUNT(DISTINCT visitor) AS visitors ${base} GROUP BY client_type ORDER BY visitors DESC`),
      q(`SELECT country, COUNT(DISTINCT visitor) AS visitors ${base} AND country IS NOT NULL GROUP BY country ORDER BY visitors DESC LIMIT 50`),
      env.DB.prepare(
        `SELECT path, ref_host, ref_path, COUNT(*) AS count ${notFoundBase} GROUP BY path, ref_host, ref_path ORDER BY count DESC LIMIT 100`
      ).bind(fromTs, toTs),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM events WHERE ts >= ? AND ts < ? AND flags IS NOT NULL`).bind(fromTs, toTs),
      env.DB.prepare(
        `SELECT flags, COUNT(*) AS count FROM events WHERE ts >= ? AND ts < ? AND flags IS NOT NULL
         GROUP BY flags ORDER BY count DESC`
      ).bind(fromTs, toTs)
    ]);

  const totals = totalsR.results[0] as { pageviews: number; visitors: number } | undefined;
  const flaggedTotal = flaggedTotalR.results[0] as { n: number } | undefined;
  const timeseries = timeseriesR.results, pages = pagesR.results, referrers = referrersR.results;
  const channels = channelsR.results, devices = devicesR.results, clientTypes = clientTypesR.results;
  const countries = countriesR.results, notFound = notFoundR.results, flaggedReasons = flaggedReasonsR.results;

  return json({
    range: { from, to },
    totals: totals ?? { pageviews: 0, visitors: 0 },
    timeseries, pages, referrers, channels, devices, clientTypes, countries, notFound,
    flagged: { total: flaggedTotal?.n ?? 0, reasons: flaggedReasons, excluded: !includeFlagged }
  });
}

async function readRaw(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = requireToken(request, env);
  if (auth) return auth;

  const { fromTs, toTs } = dateRange(url);
  const since = Math.max(0, parseInt(url.searchParams.get("since") || "0", 10) || 0);
  const limit = Math.min(1000, Math.max(1, parseInt(url.searchParams.get("limit") || "500", 10) || 500));
  const includeFlagged = url.searchParams.get("include_flagged") === "1";

  let where = `ts >= ? AND ts < ? AND id > ?`;
  const binds: (string | number)[] = [fromTs, toTs, since];
  if (!includeFlagged) where += " AND flags IS NULL";

  const rows = (await env.DB.prepare(
    `SELECT * FROM events WHERE ${where} ORDER BY id ASC LIMIT ?`
  ).bind(...binds, limit).all()).results as Array<{ id: number }>;

  const next = rows.length === limit ? rows[rows.length - 1].id : null;
  return json({ events: rows, next });
}

/* --------------------------------- helpers --------------------------------- */

function requireToken(request: Request, env: Env): Response | null {
  if (!env.READ_TOKEN) return json({ error: "READ_TOKEN not configured" }, 503);
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!timingSafeEqual(token, env.READ_TOKEN)) return json({ error: "unauthorized" }, 401);
  return null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function getDailySalt(env: Env): Promise<string> {
  const day = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
  const existing = await env.DB.prepare(`SELECT salt FROM salts WHERE day = ?`).bind(day).first<{ salt: string }>();
  if (existing) return existing.salt;

  const salt = crypto.randomUUID() + crypto.randomUUID();
  await env.DB.prepare(`INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)`).bind(day, salt).run();
  // Keep only today + yesterday.
  const cutoff = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
  await env.DB.prepare(`DELETE FROM salts WHERE day < ?`).bind(cutoff).run();
  const row = await env.DB.prepare(`SELECT salt FROM salts WHERE day = ?`).bind(day).first<{ salt: string }>();
  return row?.salt ?? salt;
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hostnameOf(ref?: string | null): string | null {
  if (!ref) return null;
  try { return new URL(ref).hostname.replace(/^www\./, ""); } catch { return null; }
}

function pathOf(ref?: string | null): string | null {
  if (!ref) return null;
  try { return new URL(ref).pathname; } catch { return null; }
}

function classifyClient(ua: string): string {
  if (AI_CRAWLER_UA.test(ua)) return "ai_crawler";
  if (SEARCH_CRAWLER_UA.test(ua)) return "search_crawler";
  if (HTTP_CLIENT_UA.test(ua)) return "http_client";
  if (HEADLESS_UA.test(ua)) return "headless";
  return "human";
}

function hostMatches(host: string, pattern: string): boolean {
  // "t.co" should match "t.co" but NOT "producthunt.com".
  // Pattern ending with "." is a prefix match (e.g. "google." matches "google.com").
  if (pattern.endsWith(".")) return host.startsWith(pattern) || host.includes("." + pattern);
  return host === pattern || host.endsWith("." + pattern);
}

function classify(refHost: string | null, utmSource: string | null = null): string {
  // AI assistants often strip the referrer but tag links, e.g. ?utm_source=chatgpt.com.
  const src = (utmSource || "").toLowerCase().trim();
  if (src && AI_HOSTS.some((x) => hostMatches(src, x))) return "ai";
  if (!refHost) return "direct";
  const h = refHost.toLowerCase();
  if (AI_HOSTS.some((x) => hostMatches(h, x))) return "ai";
  if (SEARCH_HOSTS.some((x) => hostMatches(h, x))) return "search";
  if (SOCIAL_HOSTS.some((x) => hostMatches(h, x))) return "social";
  return "referral";
}

function deviceClass(ua: string): string {
  if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) return "tablet";
  if (/Mobile|iPhone|iPod|Android.*Mobile|webOS|BlackBerry|Opera Mini|IEMobile/i.test(ua)) return "mobile";
  return "desktop";
}

function parseUtm(u: string): { source: string | null; medium: string | null; campaign: string | null } {
  try {
    const q = new URL(u, "https://x").searchParams;
    return {
      source: q.get("utm_source"),
      medium: q.get("utm_medium"),
      campaign: q.get("utm_campaign")
    };
  } catch {
    return { source: null, medium: null, campaign: null };
  }
}

function dateRange(url: URL) {
  const toParam = url.searchParams.get("to");
  const fromParam = url.searchParams.get("from");
  const to = toParam || new Date().toISOString().slice(0, 10);
  const from = fromParam || new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const fromTs = Date.parse(from + "T00:00:00Z");
  const toTs = Date.parse(to + "T00:00:00Z") + 86400_000; // inclusive of the 'to' day
  return { from, to, fromTs, toTs };
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

// The Worker serves the snippet inline so there is exactly one thing to deploy.
// Keep this in sync with /snippet/a.js.
function serveSnippet(): Response {
  // v2.4: SPA route changes send the previous in-site URL as referrer.
  const js = `(function(){try{if(localStorage.getItem("_wi_exclude"))return}catch(x){}var s=document.currentScript;var host=(s&&s.getAttribute("data-host"))||"";var is404=/^404\\b|^(page )?not found/i.test((document.title||"").trim());var dn=window.__tc_event||(s&&s.getAttribute("data-event"))||(is404?"404":"pageview");var oh=location.hostname;var lp=null;var rf=document.referrer||null;var cu=location.href;function rc(){if(location.href===cu)return;rf=cu;cu=location.href;send("pageview")}function send(n,p){var u=p||(location.pathname+location.search);if((n==="pageview"||n==="404")&&u===lp)return;if(n==="pageview"||n==="404")lp=u;try{var b=JSON.stringify({n:n,d:oh,u:u,r:rf,w:window.innerWidth||0});var ep=host+"/event";if(navigator.sendBeacon){navigator.sendBeacon(ep,new Blob([b],{type:"text/plain"}))}else{fetch(ep,{method:"POST",body:b,keepalive:true,headers:{"Content-Type":"text/plain"}})}}catch(e){}}send(dn);var ps=history.pushState;history.pushState=function(){ps.apply(this,arguments);rc()};window.addEventListener("popstate",rc);document.addEventListener("click",function(e){var el=e.target;while(el&&el!==document){var t=el.getAttribute&&el.getAttribute("data-track");if(t){send(t);return}if(el.tagName==="A"&&el.href){try{var lh=new URL(el.href).hostname;if(lh&&lh!==oh)send("outbound",el.href)}catch(x){}return}el=el.parentElement}});window.sa=function(t,n){if(t==="event"&&n)send(n)}})();`;
  return new Response(js, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=86400"
    }
  });
}
