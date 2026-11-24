@echo off
cd /d "%~dp0"
docker network inspect cordys-local_default >nul 2>&1
if errorlevel 1 (
  docker compose -f compose.yaml up -d
) else (
  docker compose -f compose.yaml -f compose.crm.yaml up -d
)
if errorlevel 1 (pause & exit /b 1)
echo Started. To verify, run: python verify.py
pause
