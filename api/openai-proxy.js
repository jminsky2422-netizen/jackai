/**
 * Proxies OpenAI chat completions (streaming) same-origin for the browser.
 * OPENAI_API_KEY: set in Vercel project env (production), or in repo-root `.env` for local `vercel dev`.
 */
const fs = require("fs");
const path = require("path");

(function loadEnvFileIfNeeded() {
  const existing = process.env.OPENAI_API_KEY;
  if (existing != null && String(existing).trim() !== "") return;

  try {
    const envPath = path.join(__dirname, "..", ".env");
    const text = fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch (_) {
    /* no or unreadable .env */
  }
})();

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).setHeader("Allow", "POST").end("Method Not Allowed");
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    res.status(503).json({
      error: {
        message: "Server is not configured with OPENAI_API_KEY",
      },
    });
    return;
  }

  let openaiRes;
  try {
    openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify(req.body),
    });
  } catch (e) {
    res.status(502).json({
      error: { message: e.message || "Upstream request failed" },
    });
    return;
  }

  const ct = openaiRes.headers.get("content-type");
  if (ct) res.setHeader("Content-Type", ct);

  res.status(openaiRes.status);

  if (!openaiRes.ok) {
    const text = await openaiRes.text();
    res.send(text);
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
  } catch (e) {
    if (!res.headersSent) {
      res.status(502).json({
        error: { message: e.message || "Stream failed" },
      });
      return;
    }
  } finally {
    res.end();
  }
};

module.exports.config = {
  maxDuration: 120,
};
