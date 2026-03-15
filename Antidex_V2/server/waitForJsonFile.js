const fs = require("node:fs");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForJsonFile({ filePath, timeoutMs = 5 * 60 * 1000, pollMs = 500, stableChecks = 2, onPoll = null } = {}) {
  const start = Date.now();
  let lastSize = -1;
  let stableCount = 0;

  while (Date.now() - start < timeoutMs) {
    if (typeof onPoll === "function") {
      // Allow callers to implement watchdogs / progress tracking during waits.
      await onPoll({ filePath, elapsedMs: Date.now() - start });
    }

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
            const cleaned = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
            try {
              const json = JSON.parse(cleaned);
              return json;
            } catch {
              // keep waiting
            }
          }
        }
      } catch {
        // ignore
      }
    }
    await sleep(pollMs);
  }
  throw new Error(`Timeout waiting for JSON file: ${filePath}`);
}

async function waitForAck({ ackPath, timeoutMs = 30_000, pollMs = 500, onPoll = null } = {}) {
  // Use 2 stable size checks to reduce the chance of reading a partially-written JSON file.
  return waitForJsonFile({ filePath: ackPath, timeoutMs, pollMs, stableChecks: 2, onPoll });
}

async function waitForResult({ resultPath, timeoutMs = 5 * 60 * 1000, pollMs = 500, onPoll = null } = {}) {
  return waitForJsonFile({ filePath: resultPath, timeoutMs, pollMs, stableChecks: 2, onPoll });
}

module.exports = { waitForJsonFile, waitForAck, waitForResult };
