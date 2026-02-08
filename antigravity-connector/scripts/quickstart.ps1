param(
  [Parameter(Mandatory = $false)][string]$Workspace = "",
  [Parameter(Mandatory = $false)][switch]$NoInstall,
  [Parameter(Mandatory = $false)][switch]$NoCompile
)

$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $here "..")

if (-not $Workspace) { $Workspace = $root.Path }

Set-Location $root

if (-not $NoInstall) {
  if (-not (Test-Path "node_modules")) {
    npm install
  }
}

if (-not $NoCompile) {
  npm run compile
}




function Find-Antigravity {
    # Confirmed CLI path in bin directory
    $explicit = "$env:USERPROFILE\AppData\Local\Programs\Antigravity\bin\antigravity.cmd"
    if (Test-Path $explicit) { return $explicit }

    $candidates = @(
        "antigravity",
        "$env:LOCALAPPDATA\Programs\Antigravity\bin\antigravity.cmd"
    )
    foreach ($c in $candidates) {
        if (Get-Command $c -ErrorAction SilentlyContinue) { return (Get-Command $c).Source }
    }
    return $null
}

$antigravity = Find-Antigravity
if ($antigravity) {
    Write-Host "Launching Antigravity detected at $antigravity..."
    # Using .cmd requires proper invocation
    & $antigravity --new-window --extensionDevelopmentPath="$root" "$Workspace"
    exit 0
}

# Fallback to VS Code
$codeCli = Get-Command code -ErrorAction SilentlyContinue
if ($codeCli) {
  Write-Host "Antigravity not found. Launching VS Code..."
  & $codeCli --new-window --extensionDevelopmentPath="$root" "$Workspace"
} else {
    Write-Warning "VS Code CLI ('code') not found. Please open this folder in VS Code/Antigravity and press F5."
}
