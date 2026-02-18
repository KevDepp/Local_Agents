$ErrorActionPreference = "Stop"

$port = 17400
$url = "http://127.0.0.1:$port"
$uiDir = Join-Path $PSScriptRoot "ui"
$serverJs = Join-Path $uiDir "server.js"

$nodeModules = Join-Path $uiDir "node_modules"
$expressMarker = Join-Path $nodeModules "express"

if (!(Test-Path $serverJs)) {
    throw "Missing UI server entrypoint: $serverJs"
}

function Test-ListeningPort($p) {
    try {
        $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction Stop
        return $c.Count -gt 0
    } catch {
        return $false
    }
}

function Wait-HttpOk($u, $timeoutMs) {
    $deadline = (Get-Date).AddMilliseconds($timeoutMs)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri ($u + "/api/health") -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
        } catch {
            Start-Sleep -Milliseconds 150
        }
    }
    return $false
}

if (Test-ListeningPort $port) {
    Start-Process $url | Out-Null
    Write-Host "UI already running on $url"
    exit 0
}

$needInstall = !(Test-Path $expressMarker)
if ($needInstall) {
    Write-Host "Installing UI dependencies (first run)..."
    Push-Location $uiDir
    try {
        & npm install
    } finally {
        Pop-Location
    }
}

$logDir = Join-Path $PSScriptRoot "ui"
$outLog = Join-Path $logDir "ui_server.out.log"
$errLog = Join-Path $logDir "ui_server.err.log"

Write-Host "Starting UI server..."
$proc = Start-Process `
    -FilePath "node" `
    -ArgumentList @("server.js") `
    -WorkingDirectory $uiDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru

if (!(Wait-HttpOk $url 8000)) {
    Write-Host "UI failed to start on $url within 8s."
    Write-Host "Logs: $outLog"
    Write-Host "Errors: $errLog"
    throw "UI startup timeout"
}

Start-Process $url | Out-Null
Write-Host "UI running on $url (pid=$($proc.Id))"
Write-Host "Logs: $outLog"
