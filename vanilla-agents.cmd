@echo off
rem Starts vanilla-agents and opens its own chromeless window (separate browser profile). Close the window to quit.
rem Everything the program needs lives in the data folder next to this file.
cd /d "%~dp0data"
where python >nul 2>nul || (
  echo Python is not installed ^(or not on PATH^). Run setup.cmd first.
  pause
  exit /b 1
)
python scripts\reconnect.py
python scripts\make_icon.py >nul 2>nul
python -m vanilla_agents.app.server --open %*
if errorlevel 1 pause
