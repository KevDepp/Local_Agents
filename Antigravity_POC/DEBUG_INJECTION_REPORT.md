# Debug Report: Prompt Injection via CDP (Resolved)

Last update: 2026-02-14
Status: resolved (validated from UI Sender)

## Context
Goal: make the local UI (`http://127.0.0.1:17400`) reliably send a prompt to Antigravity via the connector extension (`POST /send`) using CDP ("insert text + submit").

Working setup (known-good):
- Antigravity connector: `http://127.0.0.1:17375/health` (app=Antigravity)
- CDP: Antigravity launched with `--remote-debugging-port=9000`
- UI Sender: `http://127.0.0.1:17400`
- Logs mirrored to: `Local_Agents/Antigravity_POC/data/connector_output.log`

## Observed Issue (Before Fix)
When "New Thread" is NOT checked:
- First click on `Send Prompt` inserts the text into the prompt input, but does not send it.
- Second click sends the previous inserted message (even if the compose field in the UI is different).

Also seen earlier: duplicated input like `testtesttest`.

## Root Cause
1. Submit happens too early
- The connector clicked "Send" while the UI still considered the prompt empty (Send disabled).
- The click was ignored, so the prompt stayed in the input.
- By the second click, React/Lexical state was updated, so the Send action worked.

2. Double insertion (separate symptom)
- In some builds, doing `execCommand('insertText')` and also dispatching synthetic input events that contain the same text can lead to the prompt being inserted twice.

## Fix (What Worked)
Implementation lives in:
- `Local_Agents/antigravity-connector/src/cdp/injectedScript.ts`

Changes:
- Make submit deterministic:
  - After insertion, wait briefly for the Send button to become enabled (short polling).
  - Click Send.
  - Verify "sent" by observing that the editor clears (or the text drops sharply).
  - If not sent: try Enter, then Ctrl+Enter, then one retry click.
- Prevent double insertion:
  - Do not dispatch synthetic input events containing the prompt when `execCommand('insertText')` succeeded.

Key conclusion:
- "Text injected" is not "message sent".
- A reliable success signal is "editor cleared after submit".

## Quick Verification Checklist
1. Ping
- UI Sender: click `Ping`
- Expected: Antigravity toast appears and a log line is appended.

2. Send once (continue thread)
- UI Sender: uncheck `New Thread`
- Prompt begins with an ASCII token like `TOKEN: AG_UI_YYYYMMDD_HHMMSS_ABCD`
- Expected:
  - input clears on the first click
  - message appears in history
  - `connector_output.log` shows `Received prompt:` and `[CDP] Injection OK`

## Remaining Limitations
- "Continue thread" targets whatever conversation is currently active (no thread ID targeting yet).
- CDP target selection can still pick an unexpected target if multiple Antigravity windows/webviews exist.

