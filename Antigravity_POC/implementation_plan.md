# Implementation Plan - Antigravity Port Patch

## Component: Antigravity Connector (Installed)

The `antigravity-connector` is installed in `~/.antigravity/extensions`, which is the correct location for the standalone Antigravity app. However, it listens on port **17374**, which conflicts with the VS Code instance where the same extension is also installed (and currently running this session).

To allow both to coexist and ensure the test script talks to the *Antigravity App* (not VS Code), we will change the Antigravity Connector's port to **17375**.

### Proposed Changes

#### [MODIFY] [package.json](file:///C:/Users/kdeplus/.antigravity/extensions/local.antigravity-connector-0.0.1/package.json)
- Change default `antigravityConnector.port` from `17374` to `17375`.

#### [MODIFY] [dist/extension.js](file:///C:/Users/kdeplus/.antigravity/extensions/local.antigravity-connector-0.0.1/dist/extension.js)
- Change hardcoded fallback port from `17374` to `17375`.

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
