/**
 * Local dev without Vercel CLI: serves index.html and mirrors /proxy/v1/chat/completions
 * (same path as production). Loads OPENAI_API_KEY from .env in this directory.
 *
 * Usage: npm run dev:local
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

function loadEnvFile() {
  const fp = path.join(__dirname, ".env");
  if (!fs.existsSync(fp)) return;
  const text = fs.readFileSync(fp, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
};

function serveStatic(req, res) {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/") {
    urlPath = "/index.html";
  }
  let rel = decodeURIComponent(urlPath.replace(/^\/+/, ""));
  rel = path.normalize(rel);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  const file = path.join(__dirname, rel);
  if (!file.startsWith(__dirname)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end("Not found");
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

async function handleProxy(req, res) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { message: "Set OPENAI_API_KEY in .env" } }));
    return;
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const bodyBuf = Buffer.concat(chunks);

  let openaiRes;
  try {
    openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: bodyBuf,
    });
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { message: e.message || "Upstream failed" } }));
    return;
  }

  const ct = openaiRes.headers.get("content-type");
  const headers = {};
  if (ct) headers["Content-Type"] = ct;
  res.writeHead(openaiRes.status, headers);

  if (!openaiRes.ok) {
    res.end(await openaiRes.text());
    return;
  }
  if (!openaiRes.body) {
    res.end();
    return;
  }

  const reader = openaiRes.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } finally {
    res.end();
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url.startsWith("/proxy/v1/chat/completions")) {
    handleProxy(req, res).catch((e) => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: { message: String(e) } }));
      }
    });
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Jack AI local: http://127.0.0.1:${PORT} (same /proxy route as Vercel)`);
});
