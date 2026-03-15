const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");

function requestJson({ url, method = "GET", body = null, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === "https:";
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      headers: {
        "content-type": "application/json",
        "content-length": data ? Buffer.byteLength(data) : 0,
      },
    };

    const lib = isHttps ? https : http;
    const req = lib.request(opts, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        const status = res.statusCode || 0;
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : null;
        } catch {
          json = null;
        }
        resolve({ ok: status >= 200 && status < 300, status, json, text: raw });
      });
    });

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms`));
    });
    if (data) req.write(data);
    req.end();
  });
}

class AntigravityConnectorClient {
  constructor({ baseUrl = "http://127.0.0.1:17375", timeoutMs = 10_000 } = {}) {
    this.baseUrl = String(baseUrl || "http://127.0.0.1:17375").replace(/\/+$/, "");
    this.timeoutMs = Number(timeoutMs || 10_000);
  }

  async health() {
    return requestJson({ url: `${this.baseUrl}/health`, timeoutMs: this.timeoutMs });
  }

  async diagnostics() {
    return requestJson({ url: `${this.baseUrl}/diagnostics`, timeoutMs: this.timeoutMs });
  }

  async extensions() {
    return requestJson({ url: `${this.baseUrl}/extensions`, timeoutMs: this.timeoutMs });
  }

  async command({ command } = {}) {
    const body = { command: String(command || "") };
    return requestJson({
      url: `${this.baseUrl}/command`,
      method: "POST",
      body,
      timeoutMs: Math.max(this.timeoutMs, 30_000),
    });
  }

  async send({ prompt, requestId, runId, newThread, notify, debug, verifyNeedle, meta } = {}) {
    const body = {
      prompt: String(prompt || ""),
      requestId: requestId ? String(requestId) : undefined,
      runId: runId ? String(runId) : undefined,
      newThread: newThread === true,
      notify: notify === true,
      debug: debug === true,
      verifyNeedle: typeof verifyNeedle === "string" ? verifyNeedle : undefined,
      // Extra metadata (ignored by the real connector, used by tests/fakes).
      antidex: meta && typeof meta === "object" ? meta : undefined,
    };
    return requestJson({
      url: `${this.baseUrl}/send`,
      method: "POST",
      body,
      timeoutMs: Math.max(this.timeoutMs, 30_000),
    });
  }
}

module.exports = { AntigravityConnectorClient, requestJson };
