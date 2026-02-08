param(
  [int]$Port = 3210
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$env:PORT = $Port

$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($conns) {
  $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $pids) {
    try {
      $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction Stop
      $cmd = [string]$p.CommandLine
      $looksLikeThisServer = $cmd -match 'server[\\\/]index\.js'

      if ($looksLikeThisServer) {
        Write-Host "Stopping existing server on port $Port (PID $procId)"
        Stop-Process -Id $procId -Force -ErrorAction Stop
      } else {
        Write-Host "Port $Port is in use by PID $procId; not killing (command line mismatch)."
      }
    } catch {
      Write-Host ("Could not inspect/stop PID {0}: {1}" -f $procId, $_.Exception.Message)
    }
  }
  Start-Sleep -Milliseconds 300
}

$url = "http://127.0.0.1:$Port/"
Start-Process $url | Out-Null

node server/index.js
