@echo off
setlocal enableextensions

rem Antidex one-click launcher (Windows)
rem - Starts the local server (if not already running)
rem - Opens the UI in your default browser

set "ROOT=%~dp0"
cd /d "%ROOT%" || exit /b 1

if "%PORT%"=="" set "PORT=3220"
set "BASE_URL=http://127.0.0.1:%PORT%/"
set "HEALTH_URL=http://127.0.0.1:%PORT%/health"

rem If already healthy, just open the UI.
powershell -NoProfile -Command "$r=$null; try { $r=Invoke-RestMethod '%HEALTH_URL%' } catch {}; if($r -and $r.ok){ exit 0 } else { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
  start "" "%BASE_URL%"
  echo [start-ui] Antidex already running at %BASE_URL%
  exit /b 0
)

echo [start-ui] Starting Antidex server on %BASE_URL%
start "Antidex supervisor" cmd /k cd /d "%ROOT%" ^&^& set PORT=%PORT% ^&^& node scripts/supervisor.js

rem Wait for /health to respond (up to ~60s), then open the UI.
powershell -NoProfile -Command ^
  "$deadline=(Get-Date).AddSeconds(60); $ok=$false; while((Get-Date) -lt $deadline){ try { $r=Invoke-RestMethod '%HEALTH_URL%'; if($r -and $r.ok){ $ok=$true; break } } catch {}; Start-Sleep -Milliseconds 500 }; if(-not $ok){ exit 2 }" >nul 2>&1

if %errorlevel%==0 (
  start "" "%BASE_URL%"
  echo [start-ui] Opened %BASE_URL%
  exit /b 0
)

echo [start-ui] Server did not become healthy in time. Check the "Antidex server" window for errors.
exit /b 2
