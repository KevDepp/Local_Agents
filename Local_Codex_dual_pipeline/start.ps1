param(
  [int]$Port
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "[local-codex-dual-pipeline] root = $root"

if ($Port -gt 0) {
  $env:PORT = "$Port"
} else {
  $env:PORT = $env:PORT -as [string]
  if (-not $env:PORT -or -not $env:PORT.Trim()) {
    $env:PORT = "3220"
  }
}

Write-Host "Starting server on http://127.0.0.1:$($env:PORT)/"

try {
  $existing = Get-NetTCPConnection -LocalPort $env:PORT -State Listen -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Warning "Port $($env:PORT) is already in use. Stop the existing server or set PORT."
    exit 1
  }
} catch {
  # ignore
}

Start-Process powershell -ArgumentList "-NoLogo", "-NoProfile", "-Command", "cd `"$root`"; node server/index.js" | Out-Null

Start-Sleep -Seconds 1

try {
  Start-Process "http://127.0.0.1:$($env:PORT)/" | Out-Null
} catch {
  Write-Warning "Could not open browser automatically. Open http://127.0.0.1:$($env:PORT)/ manually."
}
