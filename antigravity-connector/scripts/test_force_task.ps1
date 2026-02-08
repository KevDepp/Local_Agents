param(
    [int]$Port = 17374
)

$BaseUrl = "http://127.0.0.1:$Port"
$Marker = [Guid]::NewGuid().ToString()

Write-Host "Sending 'Start task' prompt with marker: $Marker"

try {
    # We prefix with "Task:" to imply a task command, though natural language should work.
    $prompt = "Start a new task named 'AntigravityLogTest' and echo this marker: $Marker"
    $body = @{ prompt = $prompt } | ConvertTo-Json
    $res = Invoke-RestMethod -Method Post -Uri "$BaseUrl/send" -Body $body -ContentType "application/json"
    
    if ($res.ok) {
        Write-Host "Send success. Waiting 15s for agent reaction..."
    } else {
        Write-Error "Send failed: $($res.error)"
        exit
    }
} catch {
    Write-Error "Failed to call /send: $($_.Exception.Message)"
    exit
}

Start-Sleep -Seconds 15

# Search again for the marker in .gemini
$Gemini = "$env:USERPROFILE\.gemini"
Write-Host "Searching for marker in $Gemini..."

# Recursive grep via PowerShell (slower but verified)
# We look in *.md, *.jsonl, *.txt, *.resolved
$Files = Get-ChildItem $Gemini -Include "*.md", "*.jsonl", "*.txt", "*.resolved" -Recurse
$Found = $false

foreach ($f in $Files) {
    try {
        if (Select-String -Pattern $Marker -Path $f.FullName -SimpleMatch -Quiet) {
            Write-Host "FOUND MATCH in: $($f.FullName)" -ForegroundColor Green
            $Found = $true
        }
    } catch {
        # Ignore read errors
    }
}

if (-not $Found) {
    Write-Host "No match found in text files." -ForegroundColor Yellow
}
