param(
  [Parameter(Mandatory = $true)][string]$Prompt,
  [Parameter(Mandatory = $false)][string]$VsCodePort = "17373",
  [Parameter(Mandatory = $false)][string]$AntigravityPort = "17374",
  [Parameter(Mandatory = $false)][string]$Target = "auto"
)

$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path

& "$here\\send.ps1" -Port $VsCodePort -Target $Target -Prompt $Prompt | Out-Host
& "$here\\send.ps1" -Port $AntigravityPort -Target $Target -Prompt $Prompt | Out-Host

