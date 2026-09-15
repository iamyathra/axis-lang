// A tiny static file server for these examples - serves the whole repo
// root, so a page here can import "/src/mount.js" (and mount.js's own
// relative imports of its sibling language files resolve naturally,
// following the real on-disk directory structure - no flattening needed,
// unlike domServer.js's dev-server scheme) and fetch its own ".ax" source
// files by plain relative path. Not part of the AXIS package itself - just
// enough to prove these examples work over real HTTP, in a real browser,
// with no bundler involved (see docs/architecture/embedding.md's "plain
// HTML" story).
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PORT = Number(process.argv[2] ?? 0);

const CONTENT_TYPES = { ".js": "text/javascript", ".ax": "text/plain", ".html": "text/html", ".css": "text/css" };

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    const filePath = path.join(ROOT, urlPath === "/" ? "/examples/embed-html/index.html" : urlPath);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const contents = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream" });
    res.end(contents);
  } catch (err) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end(`not found: ${err.message}`);
  }
});

server.listen(PORT, "localhost", () => {
  console.log(`serving ${ROOT} at http://localhost:${server.address().port}/`);
});
