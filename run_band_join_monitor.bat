@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title BAND Join Monitor

set "SCRIPT=%~dp0band_join_monitor.py"
set "CONFIG=%~dp0band_join_monitor_config.json"
set "PYTHON_EXE="
set "USE_PY_LAUNCHER=0"

if not exist "%SCRIPT%" (
  echo [ERROR] band_join_monitor.py was not found.
  pause
  exit /b 1
)

where py >nul 2>nul
if not errorlevel 1 (
  py -3 -c "import sys; assert sys.version_info >= (3, 10)" >nul 2>nul
  if not errorlevel 1 set "USE_PY_LAUNCHER=1"
)

if "%USE_PY_LAUNCHER%"=="0" (
  where python >nul 2>nul
  if not errorlevel 1 (
    python -c "import sys; assert sys.version_info >= (3, 10)" >nul 2>nul
    if not errorlevel 1 set "PYTHON_EXE=python"
  )
)

if "%USE_PY_LAUNCHER%"=="0" if not defined PYTHON_EXE (
  set "CODEX_PY=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
  if exist "%CODEX_PY%" set "PYTHON_EXE=%CODEX_PY%"
)

if "%USE_PY_LAUNCHER%"=="0" if not defined PYTHON_EXE (
  echo [ERROR] Python 3 was not found.
  echo Install Python 3.10 or newer with "Add Python to PATH" enabled.
  echo https://www.python.org/downloads/windows/
  pause
  exit /b 1
)

if "%USE_PY_LAUNCHER%"=="1" (
  py -3 "%SCRIPT%" --config "%CONFIG%"
) else (
  "%PYTHON_EXE%" "%SCRIPT%" --config "%CONFIG%"
)

set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] The monitor exited with code %EXIT_CODE%.
  echo Check band_join_monitor.log for details.
  pause
)

endlocal & exit /b %EXIT_CODE%
