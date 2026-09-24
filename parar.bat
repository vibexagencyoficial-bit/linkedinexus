@echo off
setlocal
cd /d "%~dp0"

echo Encerrando VibexCorp (frontend - api - redis - postgres)...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\local\stop.ps1"

echo.
echo VibexCorp parado. Dados preservados em D:\vibex (pgdata/redis).
if not defined VIBEX_NO_PAUSE pause
exit /b 0
