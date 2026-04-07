/**
 * Same-origin proxy for OpenAI chat completions (streaming).
 * Set OPENAI_API_KEY in Vercel → Environment Variables or .env.local for `vercel dev`.
 */

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).setHeader("Allow", "POST").end("Method Not Allowed");
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    res.status(503).json({
      error: { message: "Server missing OPENAI_API_KEY" },
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
