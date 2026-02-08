param(
  [Parameter(Mandatory = $false)][string]$Workspace = "",
  [Parameter(Mandatory = $false)][switch]$NoInstall,
  [Parameter(Mandatory = $false)][switch]$NoCompile,
  [Parameter(Mandatory = $false)][int]$Port = 17373
)

$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $here "..")

if (-not $Workspace) { $Workspace = $root.Path }

Set-Location $root

function Find-CodeCli {
  $cmd = Get-Command code -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Find-CodeExe {
  $candidates = @(
    "$env:LOCALAPPDATA\\Programs\\Microsoft VS Code\\Code.exe",
    "C:\\Program Files\\Microsoft VS Code\\Code.exe",
    "C:\\Program Files (x86)\\Microsoft VS Code\\Code.exe",
    "$env:LOCALAPPDATA\\Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe",
    "C:\\Program Files\\Microsoft VS Code Insiders\\Code - Insiders.exe",
    "C:\\Program Files (x86)\\Microsoft VS Code Insiders\\Code - Insiders.exe"
  )
  foreach ($p in $candidates) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

if (-not $NoInstall) {
  if (-not (Test-Path (Join-Path $root "node_modules"))) {
    npm install
  }
}

if (-not $NoCompile) {
  npm run compile
}

# Make sure the port setting is present for this workspace (so the user doesn't have to touch Settings).
$settingsDir = Join-Path $Workspace ".vscode"
$settingsPath = Join-Path $settingsDir "settings.json"
if (-not (Test-Path $settingsDir)) { New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null }
if (-not (Test-Path $settingsPath)) {
  '{ "promptBridge.port": 17373 }' | Out-File -Encoding utf8 -FilePath $settingsPath
}

try {
  $json = Get-Content $settingsPath -Raw | ConvertFrom-Json -ErrorAction Stop
} catch {
  $json = [pscustomobject]@{}
}
$json | Add-Member -NotePropertyName "promptBridge.port" -NotePropertyValue $Port -Force
$json | ConvertTo-Json -Depth 8 | Out-File -Encoding utf8 -FilePath $settingsPath

$codeCli = Find-CodeCli
if ($codeCli) {
  Write-Host "Launching Extension Host via 'code' CLI..."
  & $codeCli --new-window --extensionDevelopmentPath="$root" "$Workspace"
  exit 0
}

$codeExe = Find-CodeExe
if ($codeExe) {
  Write-Host "Launching Extension Host via Code.exe..."
  Start-Process -FilePath $codeExe -ArgumentList @(
    "--new-window",
    "--extensionDevelopmentPath=$root",
    $Workspace
  )
  exit 0
}

Write-Warning "Impossible de trouver VS Code (code/Code.exe)."
Write-Warning "Fallback: ouvre $root dans VS Code, puis Run and Debug → 'Run Extension' → F5."
exit 2

