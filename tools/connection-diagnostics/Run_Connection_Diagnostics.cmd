@echo off
setlocal
title MomoCamera Connection Diagnostics
set "MOMO_DIAGNOSTICS_EXIT=0"
echo Please open MomoCamera PC before collecting connection information.
echo This tool does not change firewall, VPN or network settings.
echo.
if not exist "%~dp0Collect-ConnectionInfo.ps1" goto missing_collector
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0Collect-ConnectionInfo.ps1"
set "MOMO_DIAGNOSTICS_EXIT=%ERRORLEVEL%"
if not "%MOMO_DIAGNOSTICS_EXIT%"=="0" goto collector_failed
echo.
echo Send the ConnectionReport .txt file from this folder to the developer.
goto finished
:missing_collector
set "MOMO_DIAGNOSTICS_EXIT=1"
echo ERROR: Collect-ConnectionInfo.ps1 is missing.
echo Extract ALL files from the ZIP into one folder, then run this CMD again.
goto finished
:collector_failed
echo.
echo ERROR: The collector could not finish. The error is shown above.
echo Keep this window open and send a screenshot to the developer.
:finished
echo.
echo Press any key to close this window.
pause >nul
exit /b %MOMO_DIAGNOSTICS_EXIT%
