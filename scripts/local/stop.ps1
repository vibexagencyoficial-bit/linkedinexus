# VibexCorp — derruba a stack local na ordem inversa (frontend -> api -> redis -> postgres).
# Uso: powershell -ExecutionPolicy Bypass -File scripts\local\stop.ps1
$ErrorActionPreference = "Continue"

function Kill-ByPort($Port, $Label) {
  $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    try {
      $p = Get-Process -Id $c.OwningProcess -ErrorAction Stop
      Write-Host "[stop] $Label (PID $($p.Id) $($p.ProcessName)) ..."
      Stop-Process -Id $p.Id -Force
    } catch { Write-Host "[stop] $Label pid $($c.OwningProcess) ja saiu." }
  }
}

function Kill-ByName($Names, $Label) {
  foreach ($n in $Names) {
    Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object {
      Write-Host "[stop] $Label (PID $($_.Id) $($_.ProcessName)) ..."
      Stop-Process -Id $_.Id -Force
    }
  }
}

# 1. Frontend (3001) — derruba o next-server; o watcher "npm run dev" cai junto
Kill-ByPort 3001 "frontend"
# 2. API (8080)
Kill-ByPort 8080 "api"
Kill-ByName @("api") "api(bin)"
# 3. Redis (6380) — somente o nosso na 6380; nunca toca 6379 alheia
$redisPid = (Get-NetTCPConnection -LocalPort 6380 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
if ($redisPid) {
  Write-Host "[stop] redis :6380 (PID $redisPid) ..."
  Stop-Process -Id $redisPid -Force
} else { Write-Host "[stop] redis :6380 ja parado." }
# 4. Postgres (cluster D:\vibex\pgdata)
$pgCtl = "D:\vibex\tools\pgsql\bin\pg_ctl.exe"
if ((Test-Path $pgCtl) -and (Test-Path "D:\vibex\pgdata\PG_VERSION")) {
  Write-Host "[stop] postgres ..."
  & $pgCtl -D "D:\vibex\pgdata" stop -m fast 2>&1 | Select-Object -First 3
} else { Write-Host "[stop] postgres: cluster D:\vibex\pgdata inexistente, nada a fazer." }

Write-Host "[ok] stack parada. Dados preservados em D:\vibex (pgdata/redis)."
