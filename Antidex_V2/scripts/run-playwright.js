#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");

function buildCandidate(nodeModulesDir) {
  if (!nodeModulesDir) {
    return null;
  }
  return {
    nodeModulesDir,
    cliPath: path.join(nodeModulesDir, "@playwright", "test", "cli.js"),
  };
}

const candidates = [
  buildCandidate(process.env.ANTIDEX_PLAYWRIGHT_NODE_MODULES),
  buildCandidate(path.join(projectRoot, "node_modules")),
  buildCandidate(path.join(projectRoot, "..", "Antidex", "node_modules")),
].filter(Boolean);

const selected = candidates.find((candidate) => fs.existsSync(candidate.cliPath));

if (!selected) {
  const expected = candidates.map((candidate) => `- ${candidate.cliPath}`).join("\n");
  console.error(
    [
      "Playwright introuvable pour Antidex_V2.",
      "Chemins verifies:",
      expected,
      "Installez les dependances localement (`npm install`) ou reutilisez un checkout voisin via ANTIDEX_PLAYWRIGHT_NODE_MODULES.",
    ].join("\n"),
  );
  process.exit(1);
}

const nodePathEntries = [
  selected.nodeModulesDir,
  process.env.NODE_PATH,
].filter(Boolean);

const result = spawnSync(
  process.execPath,
  [selected.cliPath, ...process.argv.slice(2)],
  {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_PATH: nodePathEntries.join(path.delimiter),
    },
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
