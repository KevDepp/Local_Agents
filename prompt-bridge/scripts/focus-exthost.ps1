param(
  [Parameter(Mandatory = $false)][string]$TitleContains = "Extension Development Host",
  [Parameter(Mandatory = $false)][string]$DevPath = "",
  [Parameter(Mandatory = $false)][int]$ExtensionHostProcessId = 0,
  [Parameter(Mandatory = $false)][int]$TimeoutSeconds = 10
)

$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $here "..")
if (-not $DevPath) { $DevPath = $root.Path }

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@

function Get-ExtensionHostWindowProcess([string]$TitleContains, [string]$DevPath) {
  # 0) Best path: map an extension-host PID to its parent window process.
  if ($ExtensionHostProcessId -gt 0) {
    try {
      $procId = $ExtensionHostProcessId
      $wmi = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction Stop
      if ($wmi -and $wmi.ParentProcessId) {
        $parent = [System.Diagnostics.Process]::GetProcessById([int]$wmi.ParentProcessId)
        if ($parent -and $parent.MainWindowHandle -ne 0) { return $parent }
      }
    } catch {}
  }

  # 1) Fast path: window title contains "Extension Development Host" (or custom).
  $title = ""
  if ($null -ne $TitleContains) { $title = $TitleContains }
  $title = $title.Trim()
  if ($title) {
    $candidates = @()
    foreach ($p in [System.Diagnostics.Process]::GetProcesses()) {
      try {
        if ($p.MainWindowHandle -eq 0) { continue }
        if (-not $p.MainWindowTitle) { continue }
        if ($p.MainWindowTitle -like "*$title*") { $candidates += $p }
      } catch {}
    }
    if ($candidates.Count -gt 0) {
      return ($candidates | Sort-Object StartTime -Descending | Select-Object -First 1)
    }
  }

  # 2) Fallback: search Code.exe processes by command line for --extensionDevelopmentPath.
  $devPathEsc = $DevPath.Replace("\\", "\\\\")
  $procs = Get-CimInstance Win32_Process -Filter "Name='Code.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*--extensionDevelopmentPath*$DevPath*" }

  if (-not $procs) {
    $procs = Get-CimInstance Win32_Process -Filter "Name='Code - Insiders.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine -like "*--extensionDevelopmentPath*$DevPath*" }
  }

  if ($procs) {
    $pid = ($procs | Sort-Object CreationDate -Descending | Select-Object -First 1).ProcessId
    try { return [System.Diagnostics.Process]::GetProcessById($pid) } catch { return $null }
  }

  return $null
}

$previous = [Win32]::GetForegroundWindow()

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$proc = $null
while ((Get-Date) -lt $deadline) {
  $proc = Get-ExtensionHostWindowProcess -TitleContains $TitleContains -DevPath $DevPath
  if ($proc -and $proc.MainWindowHandle -ne 0) { break }
  Start-Sleep -Milliseconds 200
}

if (-not $proc -or $proc.MainWindowHandle -eq 0) {
  throw "Could not find a VS Code window for the Extension Development Host (TitleContains='$TitleContains')"
}

$hWnd = $proc.MainWindowHandle
# 9 = SW_RESTORE
[void][Win32]::ShowWindowAsync($hWnd, 9)
[void][Win32]::SetForegroundWindow($hWnd)

[pscustomobject]@{
  ok = $true
  pid = $proc.Id
  title = $proc.MainWindowTitle
  hWnd = $hWnd
  previousHWnd = $previous
}
