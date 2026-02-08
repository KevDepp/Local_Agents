param(
  [Parameter(Mandatory = $false)][int]$Port = 17373,
  [Parameter(Mandatory = $true)][string]$Prompt,
  [Parameter(Mandatory = $false)][int]$TimeoutSeconds = 30,
  [Parameter(Mandatory = $false)][switch]$EnsureHost,
  [Parameter(Mandatory = $false)][bool]$FocusHost = $true
)

$ErrorActionPreference = "Stop"

function Get-Health([string]$Base) {
  return Invoke-RestMethod -Method Get -Uri "$Base/health"
}

function Ensure-ExtensionHost([string]$Base, [int]$Port, [int]$TimeoutSeconds) {
  try {
    $h = Get-Health $Base
    return $h
  } catch {
    if (-not $EnsureHost) { throw }
  }

  $here = Split-Path -Parent $MyInvocation.MyCommand.Path
  $root = Resolve-Path (Join-Path $here "..")
  Set-Location $root

  & (Join-Path $root "scripts\\quickstart.ps1") -NoInstall -NoCompile -Port $Port | Out-Null

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      return (Get-Health $Base)
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  throw "Prompt Bridge not reachable on $Base/health after ${TimeoutSeconds}s"
}

function Find-LatestCodexLog {
  $logRoot = Join-Path $env:APPDATA "Code\\logs"
  if (-not (Test-Path $logRoot)) { return $null }

  # Fast path: look in the most recently touched log "day" folders first.
  $days = Get-ChildItem -Path $logRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 6

  foreach ($d in $days) {
    $pattern = Join-Path $d.FullName "window*\\exthost\\openai.chatgpt\\Codex.log"
    $hits = Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($hits) { return $hits.FullName }
  }

  # Fallback (slower): full scan.
  $hit =
    Get-ChildItem $logRoot -Recurse -Filter "Codex.log" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "openai\\.chatgpt" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($hit) { return $hit.FullName }
  return $null
}

function Find-WindowForExtensionHostPid([int]$ExthostPid) {
  $logRoot = Join-Path $env:APPDATA "Code\\logs"
  if (-not (Test-Path $logRoot)) { return $null }

  $days = Get-ChildItem -Path $logRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 10

  foreach ($d in $days) {
    $pattern = Join-Path $d.FullName "window*\\exthost\\exthost.log"
    $logs = Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue
    foreach ($l in $logs) {
      $hit = Select-String -Path $l.FullName -Pattern ("Extension host with pid " + $ExthostPid + " started") -SimpleMatch -ErrorAction SilentlyContinue
      if ($hit) { return (Split-Path -Parent $l.FullName) }
    }
  }

  return $null
}

function Count-Matches([string]$Path, [string[]]$Patterns) {
  if (-not $Path) { return 0 }
  if (-not (Test-Path $Path)) { return 0 }
  $count = 0
  foreach ($p in $Patterns) {
    $count += (Select-String -Path $Path -Pattern $p -SimpleMatch -ErrorAction SilentlyContinue | Measure-Object).Count
  }
  return $count
}

$base = "http://127.0.0.1:$Port"

$health = Ensure-ExtensionHost -Base $base -Port $Port -TimeoutSeconds $TimeoutSeconds

$focusInfo = $null
if ($FocusHost) {
  try {
    $here = Split-Path -Parent $MyInvocation.MyCommand.Path
    $root = Resolve-Path (Join-Path $here "..")
    $focusInfo = & (Join-Path $root "scripts\\focus-exthost.ps1") -DevPath $root.Path -ExtensionHostProcessId $health.pid -TimeoutSeconds ([Math]::Max(5, [Math]::Min($TimeoutSeconds, 20)))
  } catch {
    # Focus is best-effort; sending still may work even if the window is hidden.
    $focusInfo = [pscustomobject]@{ ok = $false; error = $_.Exception.Message }
  }
}

$deadline = (Get-Date).AddSeconds([Math]::Max(5, $TimeoutSeconds))
$codexLog = $null
while ((Get-Date) -lt $deadline) {
  $win = Find-WindowForExtensionHostPid -ExthostPid $health.pid
  if ($win) {
    $candidate = Join-Path $win "openai.chatgpt\\Codex.log"
    if (Test-Path $candidate) { $codexLog = $candidate; break }
  }
  $codexLog = Find-LatestCodexLog
  if ($codexLog) { break }
  Start-Sleep -Milliseconds 500
}
if (-not $codexLog) {
  # Still allow sending even if we can't locate logs (verification will be disabled).
  $codexLog = $null
}

$successPatterns = @(
  "Conversation created:",
  "turn/start",
  "turn/started",
  "turn/completed"
)

$beforeCount = Count-Matches -Path $codexLog -Patterns $successPatterns
$beforeWrite = $null
if ($codexLog) { $beforeWrite = (Get-Item $codexLog).LastWriteTime }

$body = @{ prompt = $Prompt; target = "codex" } | ConvertTo-Json
$resp = Invoke-RestMethod -Method Post -Uri "$base/send" -Body $body -ContentType "application/json"

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$verified = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  if ($codexLog) {
    $afterCount = Count-Matches -Path $codexLog -Patterns $successPatterns
    $afterWrite = (Get-Item $codexLog).LastWriteTime
    if ($afterCount -gt $beforeCount -or ($beforeWrite -and $afterWrite -gt $beforeWrite)) {
      $verified = $true
      break
    }
  } else {
    break
  }
}

[pscustomobject]@{
  ok = [bool]$resp.ok
  verified = $verified
  bridge = $resp
  codexLog = $codexLog
  health = $health
  focus = $focusInfo
}
