param(
    [int]$Port = 17374
)

$BaseUrl = "http://127.0.0.1:$Port"

Write-Host "Triggering Read Sequence (Focus -> SelectAll -> Copy)..."
try {
    $res = Invoke-RestMethod -Method Post -Uri "$BaseUrl/read" -Body "{}" -ContentType "application/json"
    if ($res.ok) {
        Write-Host "Read Success! Content Length: $($res.length)"
        Write-Host "----------------"
        Write-Host $res.content
        Write-Host "----------------"
    } else {
        Write-Error "Read failed: $($res.error)"
    }
} catch {
    Write-Error "Failed to call /read: $($_.Exception.Message)"
}
