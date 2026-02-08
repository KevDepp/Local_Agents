param(
  [Parameter(Mandatory = $true)][string]$Prompt,
  [Parameter(Mandatory = $false)][string]$Cwd = (Get-Location).Path,
  [Parameter(Mandatory = $false)][ValidateSet("read-only", "workspace-write", "danger-full-access")][string]$Sandbox = "read-only",
  [Parameter(Mandatory = $false)][ValidateSet("never", "untrusted", "on-request", "on-failure")][string]$ApprovalPolicy = "never",
  [Parameter(Mandatory = $false)][string]$Model,
  [Parameter(Mandatory = $false)][string]$ThreadId,
  [Parameter(Mandatory = $false)][int]$TimeoutSeconds = 120,
  [Parameter(Mandatory = $false)][string]$LogPath,
  [Parameter(Mandatory = $false)][switch]$Trace
)

$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeScript = Join-Path $here "codex-appserver-ask.js"
if (-not (Test-Path $nodeScript)) {
  throw "Missing Node script: $nodeScript"
}

$node = Get-Command node -ErrorAction Stop

$args = @(
  $nodeScript
  "--prompt", $Prompt
  "--cwd", $Cwd
  "--sandbox", $Sandbox
  "--approval-policy", $ApprovalPolicy
  "--timeout", [string]$TimeoutSeconds
)

if ($Model) { $args += @("--model", $Model) }
if ($ThreadId) { $args += @("--thread-id", $ThreadId) }
if ($LogPath) { $args += @("--log", $LogPath) }
if ($Trace) { $args += @("--trace") }

$stderrPath = Join-Path $env:TEMP ("codex-appserver-ask_" + [Guid]::NewGuid().ToString("n") + ".stderr.txt")
try {
  $stdout = & $node.Source @args 2> $stderrPath
  $exit = $LASTEXITCODE
  if ($exit -ne 0) {
    $err = ""
    if (Test-Path $stderrPath) { $err = (Get-Content $stderrPath -Raw) }
    throw ("Node app-server client failed (exitCode=$exit). " + ($err.Trim() | ForEach-Object { $_ }))
  }

  if (-not $stdout) { throw "No stdout received from Node app-server client." }
  $text = ($stdout -join "`n")
  return ($text | ConvertFrom-Json -ErrorAction Stop)
} finally {
  Remove-Item -Force -ErrorAction SilentlyContinue $stderrPath
}

