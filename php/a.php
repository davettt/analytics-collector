<?php
/**
 * analytics-collector — PHP + SQLite variant (v1)
 *
 * For traditional shared hosting (cPanel / self-hosted WordPress hosts).
 * Drop this file + the included .htaccess into a folder on your site, e.g. /_a/,
 * set READ_TOKEN below, and add the snippet to your pages. SQLite stores data in
 * a flat file next to this script — it does NOT use your MySQL database.
 *
 * Implements the same wire protocol as the Cloudflare variant (see PROTOCOL.md):
 *   POST .../event   GET .../stats   GET .../events   GET .../meta   GET .../a.js
 */

// ----------------------------- CONFIG (edit me) -----------------------------
const READ_TOKEN = 'CHANGE-ME-to-a-long-random-string'; // dashboard read token
const SITE_DOMAIN = '';                                  // your hostname; '' = accept any (disables origin checks)
const STRICT_ORIGIN = false;                             // true = drop suspect traffic; false = store + flag it
const DB_FILE = __DIR__ . '/analytics.sqlite';           // created automatically
const PROTOCOL_VERSION = 1;
// ----------------------------------------------------------------------------

$AI_HOSTS     = ['chatgpt.com','chat.openai.com','claude.ai','perplexity.ai','gemini.google.com','copilot.microsoft.com','deepseek.com','grok.com','x.ai','you.com','poe.com'];
$SEARCH_HOSTS = ['google.','bing.com','duckduckgo.com','ecosia.org','search.brave.com','yahoo.com','baidu.com','yandex.'];
$SOCIAL_HOSTS = ['facebook.com','instagram.com','t.co','twitter.com','x.com','linkedin.com','reddit.com','youtube.com','news.ycombinator.com','mastodon','bsky.app','pinterest.','tiktok.com'];

$path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
$ep = isset($_GET['e']) ? $_GET['e'] : route_suffix($path); // path style, or ?e= fallback

switch ($ep) {
    case 'a.js':  serve_snippet(); break;
    case 'meta':  send_json(['protocol' => PROTOCOL_VERSION, 'domain' => SITE_DOMAIN ?: null, 'engine' => 'php-sqlite']); break;
    case 'event': ingest(); break;
    case 'stats': read_stats(); break;
    case 'events': read_raw(); break;
    default: http_response_code(404); echo 'Not found';
}

function route_suffix($path) {
    foreach (['event','stats','events','meta','a.js'] as $s) {
        $len = strlen($s);
        if (strlen($path) >= $len && substr_compare($path, $s, -$len) === 0) return $s;
    }
    return '';
}

function db() {
    static $pdo = null;
    if ($pdo) return $pdo;
    $pdo = new PDO('sqlite:' . DB_FILE);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec('PRAGMA journal_mode=WAL');
    $pdo->exec('PRAGMA synchronous=NORMAL');
    $pdo->exec('PRAGMA busy_timeout=5000');
    $pdo->exec('CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, name TEXT NOT NULL,
        domain TEXT NOT NULL, path TEXT NOT NULL, visitor TEXT NOT NULL, ref_host TEXT,
        channel TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, device TEXT,
        country TEXT, flags TEXT)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_events_visitor ON events (visitor)');
    $pdo->exec('CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL)');
    return $pdo;
}

function ingest() {
    http_response_code(202); // always 202
    header('Access-Control-Allow-Origin: *');
    try {
        $ua = $_SERVER['HTTP_USER_AGENT'] ?? '';

        $ev = json_decode(file_get_contents('php://input'), true);
        if (!$ev || empty($ev['d']) || !isset($ev['u'])) return;          // malformed → always dropped
        if (SITE_DOMAIN !== '' && $ev['d'] !== SITE_DOMAIN) return;        // wrong site → always dropped

        // Collect soft-suspicion flags. Strict mode drops them; otherwise we store
        // the event tagged so the dashboard can surface and exclude it.
        $flags = [];
        if (preg_match('/bot|crawl|spider|slurp|headless|preview|monitor|lighthouse|pingdom|gtmetrix/i', $ua)) $flags[] = 'bot';

        if (SITE_DOMAIN !== '') {
            $originHost = hostname_of($_SERVER['HTTP_ORIGIN'] ?? null) ?: hostname_of($_SERVER['HTTP_REFERER'] ?? null);
            if (!$originHost) $flags[] = 'no_origin';
            elseif ($originHost !== SITE_DOMAIN) $flags[] = 'origin_mismatch';
        }

        if (STRICT_ORIGIN && $flags) return;                              // drop, don't store
        $flagStr = $flags ? implode(',', $flags) : null;

        $ip = $_SERVER['REMOTE_ADDR'] ?? '';
        $salt = daily_salt();
        $visitor = hash('sha256', $salt . $ev['d'] . $ip . $ua);
        $refHost = hostname_of($ev['r'] ?? null);
        $utm = parse_utm($ev['u']);

        $stmt = db()->prepare('INSERT INTO events
            (ts, name, domain, path, visitor, ref_host, channel, utm_source, utm_medium, utm_campaign, device, country, flags)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
        $stmt->execute([
            (int)(microtime(true) * 1000),
            substr($ev['n'] ?? 'pageview', 0, 80),
            substr($ev['d'], 0, 255),
            substr($ev['u'], 0, 1024),
            $visitor,
            $refHost,
            classify($refHost),
            $utm['source'], $utm['medium'], $utm['campaign'],
            device_class((int)($ev['w'] ?? 0)),
            null, // country: not resolved on shared hosting without GeoIP
            $flagStr
        ]);
    } catch (Throwable $e) { /* swallow */ }
}

function read_stats() {
    require_token();
    $r = date_range();
    list($from, $to, $fromTs, $toTs) = [$r['from'], $r['to'], $r['fromTs'], $r['toTs']];
    $pdo = db();

    // Clean reports by default: exclude flagged (likely bot/spam) traffic.
    // Pass ?include_flagged=1 to include it.
    $includeFlagged = ($_GET['include_flagged'] ?? '') === '1';
    $f = $includeFlagged ? '' : ' AND flags IS NULL';

    $totals = $pdo->prepare("SELECT COUNT(*) pageviews, COUNT(DISTINCT visitor) visitors FROM events WHERE ts>=? AND ts<? AND name='pageview'" . $f);
    $totals->execute([$fromTs, $toTs]);
    $flaggedTotal = $pdo->prepare("SELECT COUNT(*) n FROM events WHERE ts>=? AND ts<? AND flags IS NOT NULL");
    $flaggedTotal->execute([$fromTs, $toTs]);

    send_json([
        'range' => ['from' => $from, 'to' => $to],
        'totals' => $totals->fetch(PDO::FETCH_ASSOC) ?: ['pageviews' => 0, 'visitors' => 0],
        'timeseries' => q($pdo, "SELECT date(ts/1000,'unixepoch') day, COUNT(*) pageviews, COUNT(DISTINCT visitor) visitors FROM events WHERE ts>=? AND ts<? AND name='pageview'" . $f . " GROUP BY day ORDER BY day", [$fromTs, $toTs]),
        'pages' => q($pdo, "SELECT path, COUNT(*) pageviews, COUNT(DISTINCT visitor) visitors FROM events WHERE ts>=? AND ts<? AND name='pageview'" . $f . " GROUP BY path ORDER BY pageviews DESC LIMIT 100", [$fromTs, $toTs]),
        'referrers' => q($pdo, "SELECT ref_host, COUNT(DISTINCT visitor) visitors FROM events WHERE ts>=? AND ts<? AND ref_host IS NOT NULL" . $f . " GROUP BY ref_host ORDER BY visitors DESC LIMIT 100", [$fromTs, $toTs]),
        'channels' => q($pdo, "SELECT channel, COUNT(DISTINCT visitor) visitors FROM events WHERE ts>=? AND ts<?" . $f . " GROUP BY channel ORDER BY visitors DESC", [$fromTs, $toTs]),
        'devices' => q($pdo, "SELECT device, COUNT(DISTINCT visitor) visitors FROM events WHERE ts>=? AND ts<?" . $f . " GROUP BY device ORDER BY visitors DESC", [$fromTs, $toTs]),
        'flagged' => [
            'total' => (int)($flaggedTotal->fetchColumn() ?: 0),
            'reasons' => q($pdo, "SELECT flags, COUNT(*) count FROM events WHERE ts>=? AND ts<? AND flags IS NOT NULL GROUP BY flags ORDER BY count DESC", [$fromTs, $toTs]),
            'excluded' => !$includeFlagged,
        ],
    ]);
}

function read_raw() {
    require_token();
    $since = max(0, (int)($_GET['since'] ?? 0));
    $limit = min(1000, max(1, (int)($_GET['limit'] ?? 500)));
    $rows = q(db(), 'SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT ?', [$since, $limit]);
    $next = count($rows) === $limit ? $rows[count($rows) - 1]['id'] : null;
    send_json(['events' => $rows, 'next' => $next]);
}

// ------------------------------- helpers ------------------------------------
function require_token() {
    if (READ_TOKEN === 'CHANGE-ME-to-a-long-random-string' || READ_TOKEN === '') send_json(['error' => 'READ_TOKEN not configured'], 503);
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    $token = preg_replace('/^Bearer\s+/i', '', $h);
    if (!hash_equals(READ_TOKEN, $token)) send_json(['error' => 'unauthorized'], 401);
}

function daily_salt() {
    $day = gmdate('Y-m-d');
    $pdo = db();
    $sel = $pdo->prepare('SELECT salt FROM salts WHERE day=?');
    $sel->execute([$day]);
    $salt = $sel->fetchColumn();
    if ($salt) return $salt;
    $salt = bin2hex(random_bytes(32));
    $pdo->prepare('INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)')->execute([$day, $salt]);
    $pdo->prepare('DELETE FROM salts WHERE day < ?')->execute([gmdate('Y-m-d', time() - 2 * 86400)]);
    $sel->execute([$day]);
    return $sel->fetchColumn() ?: $salt;
}

function hostname_of($ref) {
    if (!$ref) return null;
    $h = parse_url($ref, PHP_URL_HOST);
    return $h ? preg_replace('/^www\./', '', $h) : null;
}

function classify($h) {
    global $AI_HOSTS, $SEARCH_HOSTS, $SOCIAL_HOSTS;
    if (!$h) return 'direct';
    $h = strtolower($h);
    foreach ($AI_HOSTS as $x) if (strpos($h, $x) !== false) return 'ai';
    foreach ($SEARCH_HOSTS as $x) if (strpos($h, $x) !== false) return 'search';
    foreach ($SOCIAL_HOSTS as $x) if (strpos($h, $x) !== false) return 'social';
    return 'referral';
}

function device_class($w) {
    if ($w > 0 && $w < 768) return 'mobile';
    if ($w >= 768 && $w < 1024) return 'tablet';
    return 'desktop';
}

function parse_utm($u) {
    $q = [];
    parse_str((string)parse_url($u, PHP_URL_QUERY), $q);
    return ['source' => $q['utm_source'] ?? null, 'medium' => $q['utm_medium'] ?? null, 'campaign' => $q['utm_campaign'] ?? null];
}

function date_range() {
    $to = $_GET['to'] ?? gmdate('Y-m-d');
    $from = $_GET['from'] ?? gmdate('Y-m-d', time() - 30 * 86400);
    return ['from' => $from, 'to' => $to,
            'fromTs' => strtotime($from . ' UTC') * 1000,
            'toTs' => (strtotime($to . ' UTC') + 86400) * 1000];
}

function q($pdo, $sql, $params) {
    $s = $pdo->prepare($sql);
    $s->execute($params);
    return $s->fetchAll(PDO::FETCH_ASSOC);
}

function send_json($obj, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json');
    header('Access-Control-Allow-Origin: *');
    echo json_encode($obj);
    exit;
}

function serve_snippet() {
    header('Content-Type: text/javascript; charset=utf-8');
    header('Cache-Control: public, max-age=86400');
    echo '(function(){var s=document.currentScript;var host=(s&&s.getAttribute("data-host"))||"";function send(n){try{var b=JSON.stringify({n:n,d:location.hostname,u:location.pathname+location.search,r:document.referrer||null,w:window.innerWidth||0});var u=host+"/event";if(navigator.sendBeacon){navigator.sendBeacon(u,new Blob([b],{type:"text/plain"}))}else{fetch(u,{method:"POST",body:b,keepalive:true,headers:{"Content-Type":"text/plain"}})}}catch(e){}}send("pageview");var p=history.pushState;history.pushState=function(){p.apply(this,arguments);send("pageview")};window.addEventListener("popstate",function(){send("pageview")});window.sa=function(t,n){if(t==="event"&&n)send(n)}})();';
    exit;
}
