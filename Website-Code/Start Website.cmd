@echo off
setlocal
cd /d "%~dp0"
rem Independent laptop website. No Pi models, firmware or simulation imports.
set "WEBSITE_PYTHON=%~dp0.venv\Scripts\python.exe"
if not exist "%WEBSITE_PYTHON%" if exist "%~dp0.local-python.txt" set /p "WEBSITE_PYTHON="<"%~dp0.local-python.txt"
if exist "%WEBSITE_PYTHON%" (
  "%WEBSITE_PYTHON%" "%~dp0server.py" %*
  exit /b
)
where py >nul 2>nul
if not errorlevel 1 (
  py -3 "%~dp0server.py" %*
  exit /b
)
echo Install Python 3 or create a .venv in the Website-Code folder.
echo Then run: python server.py
pause
exit /b 1
