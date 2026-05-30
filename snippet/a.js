/*!
 * analytics-collector tracking snippet (v1)
 * Cookieless. ~1KB. Sends pageviews + custom events to a same-origin collector.
 *
 * Install:
 *   <script defer src="https://example.com/_a/a.js" data-host="https://example.com/_a"></script>
 *
 * `data-host` is the collector base path. Same-origin (e.g. "/_a") is ideal —
 * no CORS, no third-party-cookie blocking. Custom events: window.sa('event', 'signup').
 */
(function () {
  var script = document.currentScript;
  var host = (script && script.getAttribute("data-host")) || "";

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

  send("pageview");

  // SPA route changes
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
