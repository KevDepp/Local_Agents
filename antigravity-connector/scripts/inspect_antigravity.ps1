param(
    [int]$Port = 17374
)

$BaseUrl = "http://127.0.0.1:$Port"

Write-Host "Getting All Extensions..."
try {
    $res = Invoke-RestMethod "$BaseUrl/extensions"
    $ids = $res.ids
    Write-Host "Found $($ids.Count) extensions."
    
    $google = $ids | Where-Object { $_ -match "antigravity" }
    Write-Host "Antigravity related extensions:"
    $google | ForEach-Object { Write-Host " - $_" }

} catch {
    Write-Error "Failed to get extensions."
    Write-Host "Error: $($_.Exception.Message)"
    if ($_.Exception.Response) {
         try {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $body = $reader.ReadToEnd()
            Write-Host "Response Body: $body"
         } catch {}
         Write-Host "Status: $($_.Exception.Response.StatusCode)"
    }
    exit
}

if ($google) {
    foreach ($id in $google) {
        Write-Host "`nInspecting $id..."
        try {
            $info = Invoke-RestMethod "$BaseUrl/extension?id=$id"
            if ($info.ok) {
                Write-Host "Active: $($info.isActive)"
                Write-Host "Methods found: $($info.methods.Count)"
                $info.methods | ForEach-Object { Write-Host "   . $_" }
            } else {
                Write-Warning "Inspection failed: $($info.error)"
            }
        } catch {
            Write-Error "Failed to inspect $id"
        }
    }
}
