@echo off
setlocal enableextensions

rem Antidex V2 one-click launcher (Windows) - Guardian mode
rem - Starts the local server under the external-corrector Guardian
rem - Opens the UI in your default browser

set "ROOT=%~dp0"
cd /d "%ROOT%" || exit /b 1

if "%PORT%"=="" set "PORT=3220"
rem This launcher is the dedicated Guardian default entrypoint: force the normal
rem auditor cadence so a stale parent-shell ANTIDEX_AUDITOR_POLL_MS test override
rem cannot silently keep the instance at 5 minutes.
set "ANTIDEX_AUDITOR_POLL_MS=900000"
if "%ANTIDEX_EXTERNAL_AUDITOR%"=="" set "ANTIDEX_EXTERNAL_AUDITOR=1"
rem This launcher is the dedicated Guardian test entrypoint: force enforcing mode so
rem a stale parent-shell ANTIDEX_AUDITOR_MODE=passive cannot silently disable auto handoff.
set "ANTIDEX_AUDITOR_MODE=enforcing"
if "%ANTIDEX_AUDITOR_ENFORCE_SIGNATURES%"=="" set "ANTIDEX_AUDITOR_ENFORCE_SIGNATURES=job/active_reference_incoherent,review/stale_loop_high_confidence,ui_or_api/stale_projection"
set "BASE_URL=http://127.0.0.1:%PORT%/"
set "HEALTH_URL=http://127.0.0.1:%PORT%/health"

rem If already healthy, just open the UI.
powershell -NoProfile -Command "$r=$null; try { $r=Invoke-RestMethod '%HEALTH_URL%' } catch {}; if($r -and $r.ok){ exit 0 } else { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
  start "" "%BASE_URL%"
  echo [start-ui-guardian] Antidex already running at %BASE_URL%
  exit /b 0
)

echo [start-ui-guardian] Starting Antidex Guardian on %BASE_URL%
echo [start-ui-guardian] Auditor poll set to %ANTIDEX_AUDITOR_POLL_MS% ms
echo [start-ui-guardian] External auditor enabled=%ANTIDEX_EXTERNAL_AUDITOR% mode=%ANTIDEX_AUDITOR_MODE%
start "Antidex guardian" cmd /k cd /d "%ROOT%" ^&^& set PORT=%PORT% ^&^& set ANTIDEX_AUDITOR_POLL_MS=%ANTIDEX_AUDITOR_POLL_MS% ^&^& set ANTIDEX_EXTERNAL_AUDITOR=%ANTIDEX_EXTERNAL_AUDITOR% ^&^& set ANTIDEX_AUDITOR_MODE=%ANTIDEX_AUDITOR_MODE% ^&^& set ANTIDEX_AUDITOR_ENFORCE_SIGNATURES=%ANTIDEX_AUDITOR_ENFORCE_SIGNATURES% ^&^& node scripts/guardian.js

rem Wait for /health to respond (up to ~60s), then open the UI.
powershell -NoProfile -Command ^
  "$deadline=(Get-Date).AddSeconds(60); $ok=$false; while((Get-Date) -lt $deadline){ try { $r=Invoke-RestMethod '%HEALTH_URL%'; if($r -and $r.ok){ $ok=$true; break } } catch {}; Start-Sleep -Milliseconds 500 }; if(-not $ok){ exit 2 }" >nul 2>&1

if %errorlevel%==0 (
  start "" "%BASE_URL%"
  echo [start-ui-guardian] Opened %BASE_URL%
  exit /b 0
)

echo [start-ui-guardian] Server did not become healthy in time. Check the "Antidex guardian" window for errors.
exit /b 2
