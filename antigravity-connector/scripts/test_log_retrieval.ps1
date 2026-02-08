param(
    [int]$Port = 17374
)

$BaseUrl = "http://127.0.0.1:$Port"
$BrainDir = "$env:USERPROFILE\.gemini\antigravity\brain"
$Marker = [Guid]::NewGuid().ToString()

Write-Host "Monitoring $BrainDir for updates..."
$InitialState = Get-ChildItem $BrainDir -Directory | Select-Object Name, LastWriteTime

# Send the prompt
Write-Host "Sending marker prompt: $Marker"
try {
    $body = @{ prompt = "Echo this marker: $Marker" } | ConvertTo-Json
    $res = Invoke-RestMethod -Method Post -Uri "$BaseUrl/send" -Body $body -ContentType "application/json"
    if ($res.ok) {
        Write-Host "Send successful."
    } else {
        Write-Error "Send failed: $($res.error)"
        exit
    }
} catch {
    Write-Error "Failed to call /send: $($_.Exception.Message)"
    exit
}

Write-Host "Waiting for brain update (10s)..."
Start-Sleep -Seconds 10

$FinalState = Get-ChildItem $BrainDir -Directory | Select-Object Name, LastWriteTime

# Find modified or new folders
$Candidates = @()
foreach ($f in $FinalState) {
    $prev = $InitialState | Where-Object { $_.Name -eq $f.Name }
    if (-not $prev -or $f.LastWriteTime -gt $prev.LastWriteTime) {
        $Candidates += $f
    }
}

Write-Host "Found $($Candidates.Count) active session candidates."

foreach ($c in $Candidates) {
    Write-Host "Inspecting session: $($c.Name)"
    $Path = Join-Path $BrainDir $c.Name
    
    # Check task.md.resolved
    $TaskFile = Join-Path $Path "task.md.resolved"
    if (Test-Path $TaskFile) {
        $Content = Get-Content $TaskFile -Raw
        if ($Content -match $Marker) {
            Write-Host "MATCH FOUND in $TaskFile!" -ForegroundColor Green
            Write-Host "--- Content Snippet ---"
            Write-Host $Content.Substring(0, [Math]::Min($Content.Length, 500))
            Write-Host "-----------------------"
        }
    }
    
    # Check other potential files like transcript or rollout
    $OtherFiles = Get-ChildItem $Path -Include "*.md", "*.jsonl", "*.txt" -Recurse
    foreach ($file in $OtherFiles) {
        if ($file.Name -ne "task.md.resolved") {
             $Content = Get-Content $file.FullName -Raw
             if ($Content -match $Marker) {
                Write-Host "MATCH FOUND in $($file.Name)!" -ForegroundColor Green
             }
        }
    }
}
