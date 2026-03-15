const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

function ensureDir(dirPath) {
    try {
        if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    } catch {
        // ignore
    }
}

function appendJsonlLine(filePath, obj) {
    try {
        if (!filePath) return false;
        ensureDir(path.dirname(filePath));
        fs.appendFileSync(filePath, `${JSON.stringify(obj)}\n`, { encoding: "utf8" });
        return true;
    } catch {
        return false;
    }
}

function readJsonBestEffort(p) {
    try {
        if (!p || !fs.existsSync(p)) return null;
        return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
        return null;
    }
}

function startServer() {
    console.log("[SUPERVISOR] Starting Antidex server...");
    const rootDir = path.join(__dirname, "..");
    const serverPath = path.join(rootDir, "server", "index.js");
    const dataDir = process.env.ANTIDEX_DATA_DIR ? path.resolve(String(process.env.ANTIDEX_DATA_DIR)) : path.join(rootDir, "data");
    const restartReqPath = path.join(dataDir, "auto_resume", "restart_request.json");

    const child = spawn("node", [serverPath], {
        stdio: "inherit",
        env: { ...process.env, ANTIDEX_SUPERVISOR: "1" },
    });

    child.on("exit", (code) => {
        if (code === 42) {
            const restartReq = readJsonBestEffort(restartReqPath);
            const at = new Date().toISOString();
            const runId = restartReq && restartReq.runId ? String(restartReq.runId) : null;
            const entry = {
                ts: at,
                reason: (restartReq && restartReq.reason) ? String(restartReq.reason) : "exit_42",
                runId,
                incident: restartReq && restartReq.incident ? String(restartReq.incident) : null,
                mode: restartReq && restartReq.mode ? String(restartReq.mode) : null,
                prev_pid: child.pid || null,
            };
            appendJsonlLine(path.join(dataDir, "restarts.jsonl"), entry);
            if (runId) {
                const runDir = path.join(dataDir, "runs", runId.replace(/[^a-zA-Z0-9_-]/g, "_"));
                appendJsonlLine(path.join(runDir, "restarts.jsonl"), entry);
            }
            try {
                if (fs.existsSync(restartReqPath)) fs.unlinkSync(restartReqPath);
            } catch {
                // ignore
            }
            console.log("[SUPERVISOR] Antidex Corrector requested restart (exit code 42). Respawning...");
            setTimeout(startServer, 1000);
        } else {
            console.log(`[SUPERVISOR] Server exited with code ${code}. Terminating.`);
            process.exit(code || 0);
        }
    });

    child.on("error", (err) => {
        console.error("[SUPERVISOR] Failed to spawn server:", err);
        process.exit(1);
    });
}

startServer();
