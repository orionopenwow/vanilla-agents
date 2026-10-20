@echo off
rem One-time setup: bakes the game art from your WoW 1.12 Data folder, connects Claude (hooks + tools), makes a Desktop shortcut.
rem Usage: setup.cmd "C:\path\to\Data"      (the folder that holds patch.MPQ)
rem Everything the program needs lives in the data folder next to this file.
cd /d "%~dp0data"
where python >nul 2>nul || (
  echo Python is not installed ^(or not on PATH^). Install Python 3.10 or newer from python.org and tick "Add python.exe to PATH".
  start "" https://www.python.org/downloads/
  pause
  exit /b 1
)
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" || (
  echo Vanilla Agents needs Python 3.10 or newer. Install a newer one from python.org, then run this again.
  start "" https://www.python.org/downloads/
  pause
  exit /b 1
)
if "%~1"=="" (
  echo Drag your WoW Data folder onto this file, or run: setup.cmd "C:\path\to\Data"
  pause
  exit /b 1
)
python scripts\setup.py --data-dir "%~1" --hooks --mcp --shortcut
rem Browser access (V-054) seals with the one package Vanilla Agents uses besides Python itself: cryptography.
python -m pip install --user --quiet --disable-pip-version-check "cryptography>=42" || echo Browser access will need the cryptography package: python -m pip install --user cryptography
pause
