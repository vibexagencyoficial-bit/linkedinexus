# VibexCorp LinkedIn Outreach — boot local SEM Docker, tudo no disco D.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\local\start.ps1
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$VibexRoot = "D:\vibex"
$PgData = "$VibexRoot\pgdata"
$PgLog = "$VibexRoot\logs\postgres.log"
$RedisDir = "$VibexRoot\redis"
$RedisLog = "$VibexRoot\logs\redis.log"
$ApiLog = "$VibexRoot\logs\api.log"
$FrontendLog = "$VibexRoot\logs\frontend.log"
$TmpDir = "$VibexRoot\tmp"

$PgPort = "5433"
$RedisPort = "6380"
$ApiPort = "8080"
$FrontendPort = "3001"

$DbName = "vibex_outreach"
$DbUser = "vibex_admin"
$DbPass = "vibex_secure_password_2026"

if (-not (Test-Path "D:\")) { throw "Disco D: nao montado. Abortando para proteger o disco C." }
foreach ($d in @($PgData, $RedisDir, "$VibexRoot\logs", $TmpDir, "$VibexRoot\cache\npm", "$VibexRoot\cache\go-build", "$VibexRoot\cache\go-mod", "$VibexRoot\cache\uv")) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force $d | Out-Null }
}

# Caches fora do C (Regra: nada de build escreve em %LOCALAPPDATA% / C:\Users)
$env:TEMP = $TmpDir; $env:TMP = $TmpDir
$env:npm_config_cache = "$VibexRoot\cache\npm"
$env:GOCACHE = "$VibexRoot\cache\go-build"
$env:GOMODCACHE = "$VibexRoot\cache\go-mod"
$env:UV_CACHE_DIR = "$VibexRoot\cache\uv"

# Runtimes autocontidos no disco D (regra: nada instala no C). Copia autonoma de Postgres 18.6 + Redis.
$PgBin = "D:\vibex\tools\pgsql\bin"
$RedisBin = "D:\vibex\tools\redis"
# postgres.exe precisa das DLLs do proprio bin no PATH (sem isso: exception 0xC0000135 no initdb/pg_ctl).
$env:PATH = "$PgBin;$RedisBin;$env:PATH"
$pgCtl = Join-Path $PgBin "pg_ctl.exe"
$psql = Join-Path $PgBin "psql.exe"
$initdb = Join-Path $PgBin "initdb.exe"
if (-not (Test-Path $pgCtl)) { throw "pg_ctl nao encontrado em $PgBin - runtime degradado; restaure D:\vibex\tools\pgsql" }
$redisServer = Join-Path $RedisBin "redis-server.exe"
if (-not (Test-Path $redisServer)) { throw "redis-server nao encontrado em $RedisBin - restaure D:\vibex\tools\redis" }

function Wait-Port($Port, $Label) {
  for ($i = 0; $i -lt 30; $i++) {
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { Write-Host "[ok] $Label na porta $Port" ; return }
    Start-Sleep -Seconds 1
  }
  throw "$Label nao subiu na porta $Port (timeout 30s). Veja os logs em $VibexRoot\logs."
}

# 1. Postgres (cluster em D:\vibex\pgdata, porta 5433)
if (-not (Test-Path (Join-Path $PgData "PG_VERSION"))) {
  # initdb recusa diretorio nao vazio: limpar residuo de boot falho (postgresql.conf
  # appendado pelo proprio script apos initdb que morreu, ex. 0xC0000135).
  Remove-Item (Join-Path $PgData "postgresql.conf") -ErrorAction SilentlyContinue
  Write-Host "[pg] initdb em $PgData ..."
  # Start-Process -Wait + redirect de arquivo: evita o deadlock de pipe nativo
  # do PowerShell quando o stdout do script e redirecionado (boot em background).
  Start-Process -FilePath $initdb -ArgumentList "-D","$PgData","-U","postgres","-E","UTF8","--auth=trust" -Wait -WindowStyle Hidden -RedirectStandardOutput "$VibexRoot\logs\initdb.log" -RedirectStandardError "$VibexRoot\logs\initdb_err.log"
  "port = $PgPort`nlisten_addresses = 'localhost'" | Out-File -Append -Encoding ascii (Join-Path $PgData "postgresql.conf")
}
$running = & $pgCtl -D $PgData status 2>&1 | Out-String
if ($running -notmatch "server is running") {
  Write-Host "[pg] iniciando cluster ..."
  # porta ja definida no postgresql.conf (appendado no initdb); sem -o "-p" no ArgumentList (quebra o quoting).
  # sem -Wait: pg_ctl start daemoniza o postgres (que nunca "termina"); o gate de readiness e o Wait-Port abaixo.
  Start-Process -FilePath $pgCtl -ArgumentList "-D","$PgData","-l",$PgLog,"start" -WindowStyle Hidden -RedirectStandardOutput "$VibexRoot\logs\pg_ctl_start.log" -RedirectStandardError "$VibexRoot\logs\pg_ctl_start_err.log"
}
Wait-Port $PgPort "postgres"

# 2. Role + database idempotentes
$env:PGPASSWORD = $DbPass
$superUser = "postgres"
$roleExists = (& $psql -h localhost -p $PgPort -U $superUser -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DbUser'" 2>$null) -join ""
if ($roleExists.Trim() -ne "1") {
  Write-Host "[pg] criando role $DbUser ..."
  & $psql -h localhost -p $PgPort -U $superUser -d postgres -c "CREATE ROLE $DbUser LOGIN PASSWORD '$DbPass';" | Out-Null
} else {
  # SUPERUSER bypassa RLS: a role da API nunca pode ser superuser (Regra 05).
  & $psql -h localhost -p $PgPort -U $superUser -d postgres -c "ALTER ROLE $DbUser NOSUPERUSER;" | Out-Null
}
$dbExists = (& $psql -h localhost -p $PgPort -U $superUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'" 2>$null) -join ""
if ($dbExists.Trim() -ne "1") {
  Write-Host "[pg] criando database $DbName ..."
  & $psql -h localhost -p $PgPort -U $superUser -d postgres -c "CREATE DATABASE $DbName OWNER $DbUser;" | Out-Null
}

# 3. Migrations 000001-000004 (ordem alfabética = ordem de versão)
$migrations = Get-ChildItem (Join-Path $RepoRoot "backend\db\migrations\*.up.sql") | Sort-Object Name
foreach ($m in $migrations) {
  Write-Host "[pg] aplicando $($m.Name) ..."
  & $psql -h localhost -p $PgPort -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -f $m.FullName | Out-Null
}
Write-Host "[ok] migrations aplicadas."

# 4. Redis (porta 6380, dump em D:\vibex\redis)
if (-not (Get-NetTCPConnection -LocalPort $RedisPort -State Listen -ErrorAction SilentlyContinue)) {
  Write-Host "[redis] iniciando ..."
  # dump.rdb/AOF em cwd=D:\vibex\redis; sem --dir (o backslash quebrava no arg parser do redis-server).
  # stdout/stderr em arquivos distintos (Start-Process exige).
  New-Item -ItemType Directory -Force "$RedisDir" | Out-Null
  Start-Process -FilePath $redisServer -WorkingDirectory "$RedisDir" -ArgumentList "--port $RedisPort --dbfilename dump.rdb --appendonly yes --requirepass vibex_redis_pass_2026" -RedirectStandardOutput "$RedisLog" -RedirectStandardError "$RedisLog.err" -WindowStyle Hidden
}
Wait-Port $RedisPort "redis"

# 5. Backend API (binário em backend\bin\api.exe, .env da raiz NÃO é lido pelo Go — env explícito)
# Carrega o .env da raiz (chaves Typesafe/Jev etc.) sem ecoar valores no log.
$DotEnvPath = Join-Path $RepoRoot ".env"
if (Test-Path $DotEnvPath) {
  Get-Content $DotEnvPath | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
      $idx = $line.IndexOf("=")
      $k = $line.Substring(0, $idx).Trim()
      $v = $line.Substring($idx + 1).Trim()
      Set-Item -Path "env:$k" -Value $v
    }
  }
}
Push-Location (Join-Path $RepoRoot "backend")
try {
  if (-not (Test-Path ".\bin\api.exe")) {
    Write-Host "[api] compilando ..."
    New-Item -ItemType Directory -Force ".\bin" | Out-Null
    go build -o .\bin\api.exe .\cmd\api
  }
} finally { Pop-Location }
if (-not (Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue)) {
  Write-Host "[api] iniciando na porta $ApiPort ..."
  # Start-Process herda o ambiente atual: define aqui (vale só para esta sessão de boot).
  $env:PORT = $ApiPort
  $env:DATABASE_URL = "postgres://${DbUser}:${DbPass}@localhost:${PgPort}/${DbName}?sslmode=disable"
  $env:REDIS_URL = "redis://:vibex_redis_pass_2026@localhost:${RedisPort}/0"
  $env:JWT_SECRET = "vibexcorp-enterprise-jwt-super-secret-key-32b"
  $env:EXTENSION_ZIP_PATH = Join-Path $RepoRoot "ext\vibexcorp-extension.zip"
  # stdout/stderr em arquivos distintos (Start-Process exige).
  Start-Process -FilePath (Join-Path $RepoRoot "backend\bin\api.exe") -WorkingDirectory (Join-Path $RepoRoot "backend") -RedirectStandardOutput $ApiLog -RedirectStandardError "$ApiLog.err" -WindowStyle Hidden
}
Wait-Port $ApiPort "api"

# 6. Frontend Next.js (porta 3001 — a 3000 pertence à alfa-engenharia)
Push-Location (Join-Path $RepoRoot "frontend")
try {
  if (-not (Get-NetTCPConnection -LocalPort $FrontendPort -State Listen -ErrorAction SilentlyContinue)) {
    Write-Host "[web] iniciando next dev na porta $FrontendPort ..."
    $env:NEXT_PUBLIC_API_URL = "http://localhost:${ApiPort}/api/v1"
    # npm é .cmd: lançar via cmd /c; stdout/stderr em arquivos distintos (Start-Process exige).
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev -- --port $FrontendPort" -RedirectStandardOutput $FrontendLog -RedirectStandardError "$FrontendLog.err" -WindowStyle Hidden
  }
} finally { Pop-Location }
Wait-Port $FrontendPort "frontend"

Write-Host ""
Write-Host "VibexCorp no ar (sem Docker, disco D):"
Write-Host "  postgres : localhost:$PgPort (dados em $PgData)"
Write-Host "  redis    : localhost:$RedisPort (dump em $RedisDir)"
Write-Host "  api      : http://localhost:$ApiPort/health"
Write-Host "  frontend : http://localhost:$FrontendPort"
Write-Host "  logs     : $VibexRoot\logs"
