param(
  [Parameter(Mandatory = $true)][string]$Prompt,
  [Parameter(Mandatory = $false)][int]$Port = 17373,
  [Parameter(Mandatory = $false)][ValidateSet("read-only","workspace-write","danger-full-access")][string]$Sandbox = "read-only",
  [Parameter(Mandatory = $false)][int]$TimeoutSeconds = 120,
  [Parameter(Mandatory = $false)][switch]$EnsureHost,
  [Parameter(Mandatory = $false)][bool]$EchoResponseToSidebar = $true,
  [Parameter(Mandatory = $false)][int]$MaxSidebarChars = 4000
)

$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $here "..")

# 1) Ask via Codex CLI (this is what we can reliably capture).
$cli = & (Join-Path $root "scripts\\codex-cli-ask.ps1") -Prompt $Prompt -Workdir $root.Path -Sandbox $Sandbox -Quiet

# 2) Send prompt to the Codex sidebar just for display.
$sidebarSend = $null
try {
  $sidebarSend = & (Join-Path $root "scripts\\send-codex.ps1") -Port $Port -Prompt $Prompt -Mode chat -TimeoutSeconds ([Math]::Min(60, $TimeoutSeconds)) -EnsureHost:$EnsureHost
} catch {
  $sidebarSend = [pscustomobject]@{ ok = $false; error = $_.Exception.Message }
}

# 3) Optionally echo the captured response back into the sidebar as a second message (user-visible).
$sidebarEcho = $null
if ($EchoResponseToSidebar) {
  try {
    $text = $cli.assistantText
    if (-not $text) { $text = "[CLI] (no assistantText extracted; see raw output)" }
    $echo = "[Réponse CLI]\n" + $text
    if ($echo.Length -gt $MaxSidebarChars) {
      $echo = $echo.Substring(0, $MaxSidebarChars) + "…"
    }
    $sidebarEcho = & (Join-Path $root "scripts\\send-codex.ps1") -Port $Port -Prompt $echo -Mode chat -TimeoutSeconds ([Math]::Min(60, $TimeoutSeconds))
  } catch {
    $sidebarEcho = [pscustomobject]@{ ok = $false; error = $_.Exception.Message }
  }
}

[pscustomobject]@{
  ok = $true
  cli = $cli
  sidebar = $sidebarSend
  sidebarEcho = $sidebarEcho
}

