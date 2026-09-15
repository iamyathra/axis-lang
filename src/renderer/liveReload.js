// The dev-server half of `axis run`'s live reload - a tiny Server-Sent
// Events hub, shared by server.js (a scene file) and domServer.js (a page).
// No new dependency: SSE is a plain, long-lived HTTP response the browser's
// built-in EventSource already knows how to read - no WebSocket library
// needed for a one-way "something changed, reload" signal. See cli.js's
// `run` command (the file watcher that calls `notify()`) and html.js/
// domHtml.js's LIVE_RELOAD_SCRIPT (the client side).

const ROUTE = "/__axis_reload__";

export function createLiveReloadHub() {
  const clients = new Set();

  return {
    // Returns true if it handled the request (the caller should stop),
    // false otherwise (the caller should keep trying its own routes).
    handleRequest(req, res) {
      if (req.url !== ROUTE) return false;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("\n"); // an initial byte so the browser's EventSource fires 'open' right away
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return true;
    },
    notify() {
      for (const res of clients) res.write("data: reload\n\n");
    },
  };
}
