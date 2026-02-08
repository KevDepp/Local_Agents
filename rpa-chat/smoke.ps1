param(
  [Parameter(Mandatory = $false)][switch]$DryRun = $true
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

& .\\run.ps1 -DryRun:([bool]$DryRun) | Out-Host

