@echo off
REM Starts the STT Logistika agent in the background (no window). Put a shortcut to this file in
REM shell:startup, or add it to Task Scheduler "At log on", so it runs whenever the office PC is on.
cd /d "%~dp0"
start "" pythonw eki_sync.py
