# VibexCorp - health das 4 camadas + portas. Exit 0 = tudo verde.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\local\status.ps1
$fail = $false
function Check($Label, $Script) {
  try { $msg = & $Script; Write-Host "[ok] $Label :: $msg" }
  catch { Write-Host "[FALHA] $Label :: $($_.Exception.Message)"; $script:fail = $true }
}

if (-not (Test-Path "D:\")) { Write-Host "[FALHA] disco D: nao montado"; exit 1 }

Check "disco D (estado em D:\vibex)" { if (-not (Test-Path "D:\vibex")) { throw "D:\vibex inexistente - rode start.ps1" }; "presente" }
Check "postgres :5433 (pg_isready)" {
  $pg = "D:\vibex\tools\pgsql\bin\pg_isready.exe"
  if (-not (Test-Path $pg)) { throw "pg_isready ausente em D:\vibex\tools\pgsql\bin" }
  (& $pg -h localhost -p 5433 | Out-String).Trim()
}
Check "postgres dados em D" { if (-not (Test-Path "D:\vibex\pgdata\PG_VERSION")) { throw "cluster fora de D:\vibex\pgdata" }; "D:\vibex\pgdata" }
Check "redis :6380 (PING)" {
  $r = "D:\vibex\tools\redis\redis-cli.exe"
  if (-not (Test-Path $r)) { throw "redis-cli ausente em D:\vibex\tools\redis" }
  $pong = & $r -p 6380 -a vibex_redis_pass_2026 ping 2>$null
  if ($pong -notmatch "PONG") { throw "sem PONG na 6380" }; "PONG"
}
Check "api :8080 (/health)" {
  # Invoke-WebRequest (sem Invoke-RestMethod): evita dependencia de System.Web no PS 5.1.
  $body = (Invoke-WebRequest -Uri "http://localhost:8080/health" -TimeoutSec 15 -UseBasicParsing).Content
  if ($body -notmatch '"status"\s*:\s*"alive"') { throw "health = $body" }; "alive"
}
Check "api usa banco real (sem fallback in-memory)" {
  $log = Get-Content "D:\vibex\logs\api.log" -ErrorAction SilentlyContinue | Select-Object -Last 50
  if ($log -match "in-memory resilient store") { throw "api caiu para in-memory - verifique DATABASE_URL e D:\vibex\pgdata" }
  "sem mensagem de fallback no boot"
}
Check "frontend :3001" {
  $res = Invoke-WebRequest -Uri "http://localhost:3001" -TimeoutSec 10 -UseBasicParsing
  if ($res.StatusCode -ne 200) { throw "HTTP $($res.StatusCode)" }; "HTTP 200"
}
Check "porta 3000 intacta (alfa-engenharia)" {
  if (-not (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) { throw "algo derrubou a 3000!" }
  "ocupada por outro projeto (correto)"
}

if ($fail) { Write-Host ""; Write-Host "STATUS: FALHA - veja itens [FALHA] acima."; exit 1 }
Write-Host ""; Write-Host "STATUS: tudo verde."
