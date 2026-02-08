const fs = require("node:fs");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForJsonFile({
  filePath,
  timeoutMs = 5 * 60 * 1000,
  pollMs = 500,
  stableChecks = 2,
} = {}) {
  const start = Date.now();
  let lastSize = -1;
  let stableCount = 0;

  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) {
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          const size = stat.size;
          if (size === lastSize) stableCount += 1;
          else stableCount = 0;
          lastSize = size;
          if (stableCount >= stableChecks) {
            const raw = fs.readFileSync(filePath, "utf8");
            try {
              const json = JSON.parse(raw);
              return json;
            } catch {
              // keep waiting (file might be partial or invalid)
            }
          }
        }
      } catch {
        // ignore and continue
      }
    }
    await sleep(pollMs);
  }

  throw new Error(`Timeout waiting for JSON file: ${filePath}`);
}

async function waitForResult(opts = {}) {
  return waitForJsonFile({
    filePath: opts.resultPath,
    timeoutMs: opts.timeoutMs,
    pollMs: opts.pollMs,
    stableChecks: opts.stableChecks ?? 2,
  });
}

async function waitForAck(opts = {}) {
  return waitForJsonFile({
    filePath: opts.ackPath,
    timeoutMs: opts.timeoutMs ?? 30_000,
    pollMs: opts.pollMs,
    stableChecks: opts.stableChecks ?? 1,
  });
}

module.exports = { waitForResult, waitForAck, waitForJsonFile };
