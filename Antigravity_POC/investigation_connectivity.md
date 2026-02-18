# Investigation: Antigravity Connectivity Issue

## Findings

1.  **Process Isolation**:
    - `Antigravity.exe` runs as a separate process tree (multiple PIDs).
    - `antigravity-connector` runs inside `Code.exe` (VS Code extension host).

2.  **Missing Inter-Process Communication (IPC)**:
    - The `antigravity-connector` extension (listening on port 17374 in VS Code) expects to find `antigravity.*` commands available in its runtime.
    - `vscode.commands.getCommands()` returns *null* or *empty* for `antigravity.*`.
    - This proves that **Process A (Code.exe)** is not connected to **Process B (Antigravity.exe)**. The extension is running in the wrong place.

3.  **Environment Mismatch**:
    - The user successfully installed the VSIX in their VS Code instance.
    - However, "Antigravity" as an agent/product likely runs its own Modified VS Code (or a completely separate shell) which has the `antigravity.*` API commands built-in.
    - Installing the extension in *standard* VS Code does not grant access to *Antigravity's* internal API.

## Conclusion
The current POC architecture (Extension in VS Code) cannot control the standalone `Antigravity.exe` application because they are sandboxed from each other.

To fix this, we must run the connector **inside** the Antigravity application itself.

## Proposed Plan

1.  **Locate Antigravity Extension Folder**:
    - Find where `Antigravity.exe` looks for extensions. It might use a separate `.vscode` directory (e.g., `.antigravity/extensions`).
  
2.  **Install Connector in Antigravity Context**:
    - Manually copy the `antigravity-connector-0.0.1.vsix` (or unzipped folder) into Antigravity's extension directory.
  
3.  **Verify Port**:
    - Once running inside Antigravity, the connector should bind a dedicated port (recommended: 17375).
    - VS Code can keep 17374. This avoids collisions and avoids accidentally targeting the wrong app.

## Immediate Action for User
We need to ask the user to investigate *their* Antigravity installation to find where to drop the extension.
