param(
  [Parameter(Mandatory = $true)][string]$Prompt,
  [Parameter(Mandatory = $false)][string]$Workdir = "",
  [Parameter(Mandatory = $false)][string]$Model = "",
  [Parameter(Mandatory = $false)][ValidateSet("read-only","workspace-write","danger-full-access")][string]$Sandbox = "read-only",
  [Parameter(Mandatory = $false)][switch]$Json,
  [Parameter(Mandatory = $false)][string]$OutFile = "",
  [Parameter(Mandatory = $false)][switch]$Quiet,
  [Parameter(Mandatory = $false)][switch]$ResumeLast,
  [Parameter(Mandatory = $false)][string]$SessionId = ""
)

$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $here "..")
if (-not $Workdir) { $Workdir = $root.Path }

function Find-CodexExe {
  $cmd = Get-Command codex -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $ext = Get-ChildItem "$env:USERPROFILE\\.vscode\\extensions" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "openai.chatgpt-*" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($ext) {
    $candidate = Join-Path $ext.FullName "bin\\windows-x86_64\\codex.exe"
    if (Test-Path $candidate) { return $candidate }
  }

  return $null
}

$exe = Find-CodexExe
if (-not $exe) { throw "Could not find codex.exe (neither in PATH nor in the OpenAI Codex VS Code extension folder)." }

if (-not $OutFile) {
  $OutFile = Join-Path $env:TEMP ("codex-last-" + [guid]::NewGuid().ToString() + ".txt")
}

$startedAt = Get-Date
$args = @("exec", "--skip-git-repo-check", "-C", $Workdir, "-s", $Sandbox, "-o", $OutFile, "--color", "never")
if ($Json) { $args += "--json" }
if ($Model) { $args += @("-m", $Model) }

if ($ResumeLast -or ($SessionId -and $SessionId.Trim().Length -gt 0)) {
  $args += "resume"
  if ($ResumeLast) {
    $args += "--last"
  } else {
    $args += $SessionId
  }
  $args += $Prompt
} else {
  $args += $Prompt
}

if ($Quiet) {
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $exe @args 1>$null 2>$null
  $exit = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  if ($exit -ne 0) { throw "codex exec failed with exit code $exit" }
} else {
  & $exe @args | Out-Host
}

$raw = [string](Get-Content -Raw $OutFile -ErrorAction SilentlyContinue)
$assistantText = $null
if ($raw) {
  $assistantText = ($raw -split "(\r?\n)" | Where-Object { $_ -and $_.Trim().Length -gt 0 } | Select-Object -First 1)
}

function Find-LatestRollout([DateTime]$Since, [string]$Workdir) {
  $sessionsRoot = Join-Path $env:USERPROFILE ".codex\\sessions"
  if (-not (Test-Path $sessionsRoot)) { return $null }

  $suffix = ""
  try {
    if ($Workdir) {
      $parts = $Workdir -split "\\\\"
      if ($parts.Length -ge 2) { $suffix = ($parts[-2] + "\\" + $parts[-1]).ToLower() }
    }
  } catch { $suffix = "" }

  $candidates =
    Get-ChildItem -Path $sessionsRoot -Recurse -File -Filter "rollout-*.jsonl" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $Since.AddSeconds(-2) } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 40

  foreach ($f in $candidates) {
    try {
      $first = Get-Content -Path $f.FullName -TotalCount 1 -ErrorAction Stop
      $meta = $first | ConvertFrom-Json -ErrorAction Stop
      if ($meta.type -ne "session_meta") { continue }
      if (-not $meta.payload) { continue }
      if ($suffix -and $meta.payload.cwd) {
        $cwdLower = [string]$meta.payload.cwd
        $cwdLower = $cwdLower.ToLower()
        if ($cwdLower -notlike "*$suffix") { continue }
      }
      return [pscustomobject]@{
        path = $f.FullName
        sessionId = $meta.payload.id
        originator = $meta.payload.originator
      }
    } catch {}
  }
  return $null
}

$rollout = Find-LatestRollout -Since $startedAt -Workdir ($Workdir.ToLower())

[pscustomobject]@{
  ok = $true
  exe = $exe
  workdir = $Workdir
  sandbox = $Sandbox
  model = $Model
  outFile = $OutFile
  assistantText = [string]$assistantText
  raw = $raw
  rollout = $rollout
}
