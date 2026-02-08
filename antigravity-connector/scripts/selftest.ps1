param(
    [int]$Port = 17374
)

$BaseUrl = "http://127.0.0.1:$Port"

Write-Host "Checking Health..."
try {
    $health = Invoke-RestMethod "$BaseUrl/health"
    Write-Host "Health OK: $($health | ConvertTo-Json -Depth 1)" -ForegroundColor Green
} catch {
    Write-Error "Failed to connect to Health endpoint. Is the extension running?"
    exit
}

Write-Host "`nGetting Diagnostics (Antigravity Commands)..."
try {
    $diag = Invoke-RestMethod "$BaseUrl/diagnostics"
    $cmds = $diag.commands
    Write-Host "Found $($cmds.Count) antigravity commands."
    $cmds | Select-Object -First 5 | ForEach-Object { Write-Host " - $_" }
} catch {
    Write-Warning "Failed to get diagnostics."
}

Write-Host "`nSending Test Prompt..."
try {
    $body = @{ prompt = "Hello from PowerShell Connector Test" } | ConvertTo-Json
    $res = Invoke-RestMethod -Method Post -Uri "$BaseUrl/send" -Body $body -ContentType "application/json"
    Write-Host "Send Result: $($res | ConvertTo-Json)"
} catch {
    Write-Error "Failed to send prompt."
}
