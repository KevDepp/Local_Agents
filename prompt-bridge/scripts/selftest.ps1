param(
  [Parameter(Mandatory = $false)][int]$Port = 17373,
  [Parameter(Mandatory = $false)][int]$Retries = 40,
  [Parameter(Mandatory = $false)][int]$DelayMs = 250,
  [Parameter(Mandatory = $false)][string]$Prompt = "Self-test: hello from Prompt Bridge"
)

$ErrorActionPreference = "Stop"

$base = "http://127.0.0.1:$Port"

for ($i = 0; $i -lt $Retries; $i++) {
  try {
    $h = Invoke-RestMethod -Method Get -Uri "$base/health"
    Write-Host "Health OK: appName=$($h.appName) pid=$($h.pid) port=$($h.port)"
    break
  } catch {
    Start-Sleep -Milliseconds $DelayMs
  }
  if ($i -eq ($Retries - 1)) {
    throw "Prompt Bridge not reachable on $base/health"
  }
}

$body = @{ prompt = $Prompt; target = "auto" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$base/send" -Body $body -ContentType "application/json" | Out-Host

