@echo off
setlocal
cd /d "%~dp0"

echo =====================================================
echo  VibexCorp Outreach - boot local (Postgres, API, web)
echo =====================================================
echo.

echo [1/4] Colocando a extensao atual dentro do frontend...
if exist "ext\vibexcorp-extension.zip" (
  if not exist "frontend\public" mkdir "frontend\public"
  copy /Y "ext\vibexcorp-extension.zip" "frontend\public\vibexcorp-extension.zip" >nul
  echo        ok: servida em http://localhost:3001/vibexcorp-extension.zip
) else (
  echo        aviso: ext\vibexcorp-extension.zip ausente - rode "npm run build" dentro de ext\
)

echo.
echo [2/4] Subindo Postgres 5433 + migracoes, Redis 6380, API 8080 e frontend 3001...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\local\start.ps1"
if errorlevel 1 goto falha_boot

echo.
echo [3/4] Checando saude: banco, API (com banco real) e frontend...
"D:\vibex\tools\pgsql\bin\pg_isready.exe" -h localhost -p 5433 >nul 2>&1
if errorlevel 1 goto falha_pg
curl -s -f http://localhost:8080/health >nul 2>&1
if errorlevel 1 goto falha_api
curl -s -f -o nul http://localhost:3001/vibexcorp-extension.zip >nul 2>&1
if errorlevel 1 goto falha_zip
curl -s -f -o nul http://localhost:3001 >nul 2>&1
if errorlevel 1 goto falha_web
findstr /C:"in-memory resilient store" "D:\vibex\logs\api.log" >nul 2>&1
if not errorlevel 1 goto falha_mem
echo        ok: banco na 5433, API viva com Postgres real, extensao e frontend no ar.

echo.
echo [4/4] Abrindo o navegador em http://localhost:3001 ...
start "" http://localhost:3001

echo.
echo -----------------------------------------------------
echo  VibexCorp no ar:
echo    frontend : http://localhost:3001  (login: admin@vibexcorp.com / admin123)
echo    api      : http://localhost:8080/health
echo    extensao : http://localhost:3001/vibexcorp-extension.zip
echo    logs     : D:\vibex\logs
echo  Para parar tudo, rode: parar.bat
echo -----------------------------------------------------
exit /b 0

:falha_boot
echo.
echo FALHA no boot - veja a saida acima e os logs em D:\vibex\logs
if not defined VIBEX_NO_PAUSE pause
exit /b 1

:falha_pg
echo        FALHA: Postgres nao responde na porta 5433 (pg_isready).
goto falha_boot

:falha_api
echo        FALHA: API nao respondeu em http://localhost:8080/health
goto falha_boot

:falha_zip
echo        FALHA: o zip da extensao nao respondeu em http://localhost:3001/vibexcorp-extension.zip
goto falha_boot

:falha_web
echo        FALHA: frontend nao respondeu em http://localhost:3001
goto falha_boot

:falha_mem
echo        FALHA: a API subiu com store in-memory - Postgres nao foi conectado.
echo               Veja D:\vibex\logs\api.log e confira o cluster em D:\vibex\pgdata
goto falha_boot
