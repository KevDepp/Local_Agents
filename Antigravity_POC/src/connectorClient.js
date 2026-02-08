const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");

function requestJson({ url, method = "GET", body = null, timeoutMs = 10_000 }) {
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

class ConnectorClient {
  constructor({ baseUrl = "http://localhost:17375" } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async health() {
    return requestJson({ url: `${this.baseUrl}/health` });
  }

  async diagnostics() {
    return requestJson({ url: `${this.baseUrl}/diagnostics` });
  }

  async extensions() {
    return requestJson({ url: `${this.baseUrl}/extensions` });
  }

  async send(prompt) {
    return requestJson({
      url: `${this.baseUrl}/send`,
      method: "POST",
      body: { prompt: String(prompt || "") },
      timeoutMs: 30_000,
    });
  }
}

module.exports = { ConnectorClient, requestJson };
