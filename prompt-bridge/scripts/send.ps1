param(
  [Parameter(Mandatory = $false)][string]$Port = "17373",
  [Parameter(Mandatory = $false)][string]$Target = "auto",
  [Parameter(Mandatory = $false)][string]$Prompt = ""
)

if (-not $Prompt) {
  Write-Error "Missing -Prompt"
  exit 1
}

$uri = "http://127.0.0.1:$Port/send"
$body = @{ prompt = $Prompt; target = $Target } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri $uri -Body $body -ContentType "application/json"
