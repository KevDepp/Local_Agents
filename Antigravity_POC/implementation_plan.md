# Implementation Plan - Antigravity Port Patch

## Component: Antigravity Connector (Installed)

The `antigravity-connector` is installed in Antigravity's own extensions directory (separate from standard VS Code). When both apps run, they must not share the same port.

To allow both to coexist and ensure the test script talks to the *Antigravity App* (not VS Code), we use:
- VS Code connector port: `17374`
- Antigravity connector port: `17375`

### Proposed Changes

#### [MODIFY] Connector source (recommended)
- Update `Local_Agents/antigravity-connector/src/extension.ts` to use a non-colliding default port in Antigravity (17375) while keeping VS Code on 17374, then rebuild/reinstall the VSIX.

#### [MODIFY] [Test Scripts]
- Update all POC test scripts to communicate on port **17375** instead of 17374.
    - `run_github_task.js`
    - `test_connection.js`
    - `test_prompt.js`
    - `test_file_loop.js`
    - `test_browser.js`

## Verification Plan

### Manual Verification
1.  **Restart Antigravity**: The user must verify that they have restarted the Antigravity application.
2.  **Check Port**: Run `netstat -ano | findstr 17375` to confirm Antigravity is listening on the new port.
3.  **Run Tests**: Execute `node run_github_task.js` (or `test_connection.js`) and confirm it receives a response from the Antigravity Agent.
