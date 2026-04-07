/**
 * Proxies OpenAI chat completions (streaming) so the browser can call same-origin.
 * Forwards the user's Bearer token from the client; no server-side API key required.
 */

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).setHeader("Allow", "POST").end("Method Not Allowed");
    return;
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({
      error: { message: "Missing or invalid Authorization header" },
    });
    return;
  }

  let openaiRes;
  try {
    openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: auth,
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
