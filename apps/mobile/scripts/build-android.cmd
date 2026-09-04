@echo off
title NikkiSync - Android Builder
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-android.ps1"
if errorlevel 1 pause
