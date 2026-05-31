/*!
 * analytics-collector tracking snippet (v2.1)
 * Cookieless. ~1.5KB. Sends pageviews, outbound clicks, tracked element clicks,
 * and custom events to a same-origin collector.
 *
 * Install:
 *   <script defer src="https://example.com/_a/a.js" data-host="https://example.com/_a"></script>
 *
 * `data-host` is the collector base path. Same-origin (e.g. "/_a") is ideal —
 * no CORS, no third-party-cookie blocking.
 *
 * Options:
 *   data-event="404"      Override the default event name (e.g. on 404 pages).
 *   data-track="name"     Add to any element to track clicks on it. The value
 *                         becomes the event name (e.g. data-track="signup-cta").
 *
 * Automatic:
 *   - 404 pages detected from document.title ("404" or "not found").
 *   - Outbound link clicks tracked as "outbound" events (destination in the path).
 *
 * Custom events: window.sa('event', 'signup')
 */
(function () {
  var script = document.currentScript;
  var host = (script && script.getAttribute("data-host")) || "";
  // Detect 404 error pages — title starts with "404" or starts with "page not found" / "not found".
  // Won't false-positive on blog posts like "How to fix 404 errors".
  var is404 = /^404\b|^(page )?not found/i.test((document.title || "").trim());
  var defaultName = window.__tc_event || (script && script.getAttribute("data-event")) || (is404 ? "404" : "pageview");
  var ownHost = location.hostname;

  function send(name, path) {
    try {
      var body = JSON.stringify({
        n: name,
        d: ownHost,
        u: path || (location.pathname + location.search),
        r: document.referrer || null,
        w: window.innerWidth || 0
      });
      var url = host + "/event";
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

  // SPA route changes
  var _push = history.pushState;
  history.pushState = function () {
    _push.apply(this, arguments);
    send("pageview");
  };
  window.addEventListener("popstate", function () {
    send("pageview");
  });

  // Click tracking (delegated to document for efficiency).
  document.addEventListener("click", function (e) {
    var el = e.target;

    // Walk up to find the nearest tracked element or link.
    while (el && el !== document) {
      // data-track="name" — explicit tracked element clicks.
      var track = el.getAttribute && el.getAttribute("data-track");
      if (track) {
        send(track);
        return;
      }

      // Outbound link clicks — <a> pointing off-site.
      if (el.tagName === "A" && el.href) {
        try {
          var linkHost = new URL(el.href).hostname;
          if (linkHost && linkHost !== ownHost) {
            send("outbound", el.href);
          }
        } catch (err) {
          /* invalid URL, skip */
        }
        return;
      }

      el = el.parentElement;
    }
  });

  // Public API for custom events: window.sa('event', 'signup')
  window.sa = function (type, name) {
    if (type === "event" && name) send(name);
  };
})();
