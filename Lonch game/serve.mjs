// Tiny local web server for Launch Lab (no install needed, Node.js 18+).
// Usage: node serve.mjs [port]   then open http://localhost:8080
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const port = Number(process.argv[2]) || 8080;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".bin": "application/octet-stream" };

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, path.normalize(p));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
}).listen(port, () => {
  console.log(`\n  Launch Lab is running.\n  Open this in Chrome:  http://localhost:${port}\n  Press Ctrl + C here to stop.\n`);
}).on("error", (e) => {
  console.error(e.code === "EADDRINUSE" ? `Port ${port} is busy. Try: node serve.mjs ${port + 10}` : e.message);
  process.exit(1);
});
