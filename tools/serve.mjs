// Tiny static dev server, zero dependencies. Not used in production (GitHub Pages serves the files).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const types = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json",
};
createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  const file = normalize(join(root, p));
  if (!file.startsWith(normalize(root))) { res.writeHead(403); res.end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(8123, () => console.log("serving on http://localhost:8123"));
