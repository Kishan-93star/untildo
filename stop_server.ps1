$port = 8000
$conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($conns) {
    foreach ($conn in $conns) {
        $procId = $conn.OwningProcess
        if ($procId -and $procId -ne 0) {
            try {
                Stop-Process -Id $procId -Force
                Write-Host "[OK] Terminated process PID $procId on port 8000" -ForegroundColor Green
            } catch {
                Write-Host "[WARN] Could not kill process PID $procId" -ForegroundColor Yellow
            }
        }
    }
} else {
    Write-Host "[INFO] No active server process found on port 8000." -ForegroundColor Cyan
}
