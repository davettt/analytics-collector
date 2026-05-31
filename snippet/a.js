/*!
 * analytics-collector tracking snippet (v2)
 * Cookieless. ~1KB. Sends pageviews + custom events to a same-origin collector.
 *
 * Install:
 *   <script defer src="https://example.com/_a/a.js" data-host="https://example.com/_a"></script>
 *
 * `data-host` is the collector base path. Same-origin (e.g. "/_a") is ideal —
 * no CORS, no third-party-cookie blocking.
 *
 * Options:
 *   data-event="404"  Override the default event name. Use on 404 pages to tag
 *                     them as not-found hits (filterable in the dashboard).
 *
 * Custom events: window.sa('event', 'signup')
 */
(function () {
  var script = document.currentScript;
  var host = (script && script.getAttribute("data-host")) || "";
  // Auto-detect 404 pages from the document title (covers most CMSes/frameworks).
  // Explicit overrides: window.__tc_event or data-event attribute on the script tag.
  var is404 = /\b404\b|not found/i.test(document.title || "");
  var defaultName = window.__tc_event || (script && script.getAttribute("data-event")) || (is404 ? "404" : "pageview");

  function send(name) {
    try {
      var body = JSON.stringify({
        n: name,
        d: location.hostname,
        u: location.pathname + location.search,
        r: document.referrer || null,
        w: window.innerWidth || 0
      });
      var url = host + "/event";
      // text/plain keeps sendBeacon a CORS-simple request (no preflight).
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }));
      } else {
        fetch(url, {
          method: "POST",
          body: body,
          keepalive: true,
          headers: { "Content-Type": "text/plain" }
        });
      }
    } catch (e) {
      /* never let analytics break the page */
    }
  }

  send(defaultName);

  // SPA route changes — always "pageview" (only the initial load uses the override)
  var _push = history.pushState;
  history.pushState = function () {
    _push.apply(this, arguments);
    send("pageview");
  };
  window.addEventListener("popstate", function () {
    send("pageview");
  });

  // Public API for custom events (forms, tabs, buttons): window.sa('event', 'name')
  window.sa = function (type, name) {
    if (type === "event" && name) send(name);
  };
})();
