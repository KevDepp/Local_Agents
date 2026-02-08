param(
  [Parameter(Mandatory = $false)][string]$Prompt = "",
  [Parameter(Mandatory = $false)][switch]$DryRun
)

$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

if (-not (Test-Path ".\\.venv")) {
  py -3.11 -m venv .venv
}

.\\.venv\\Scripts\\Activate.ps1
python -m pip install --upgrade pip | Out-Null
pip install -r requirements.txt | Out-Null

if ($Prompt) {
  Set-Clipboard -Value $Prompt
  Write-Host "Clipboard set."
}

$robotArgs = @("-d", "output")
if ($DryRun) { $robotArgs += "--dryrun" }
$robotArgs += "send_to_chats.robot"

robot @robotArgs
