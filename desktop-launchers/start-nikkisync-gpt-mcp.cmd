@echo off
title NikkiSync - GPT MCP Launcher
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-nikkisync-gpt-mcp.ps1"
if errorlevel 1 pause
