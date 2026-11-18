@echo off
REM ---------------------------------------------------------------------------
REM  SafeGPT — start the rescue bot monitoring loop.
REM
REM  Double-click this file, or run "start-monitoring.bat" from a terminal.
REM
REM  The bot watches the mempool and blocks for suspicious transactions and
REM  moves funds to the safe address before an attacker can drain the wallet.
REM
REM  Prerequisites:
REM    1. bot/config/config.yaml exists (download it from the onboarding wizard)
REM    2. The executor wallet has >= 0.001 ETH for gas
REM    3. EXECUTOR_KEY is set (either in config.yaml or in .env)
REM ---------------------------------------------------------------------------

setlocal

cd /d "%~dp0"

set BOT_DIR=%~dp0bot
set CONFIG_PATH=%BOT_DIR%\config\config.yaml

echo.
echo  ============================================
echo   SafeGPT — Rescue Bot Monitor
echo  ============================================
echo.

REM  --- Check Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js is required but was not found on your PATH.
  echo          Install it from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

REM  --- Check bot dependencies ---
if not exist "%BOT_DIR%\node_modules" (
  echo  [SETUP] Installing bot dependencies...
  pushd "%BOT_DIR%"
  call npm install
  if errorlevel 1 (
    popd
    echo  [ERROR] npm install failed. See the output above.
    echo.
    pause
    exit /b 1
  )
  popd
  echo  [SETUP] Dependencies installed.
  echo.
)

REM  --- Check config.yaml ---
if not exist "%CONFIG_PATH%" (
  echo  [ERROR] Configuration file not found:
  echo          %CONFIG_PATH%
  echo.
  echo          Create it by completing the onboarding wizard and clicking
  echo          "Download config.yaml" on the final screen. Place the downloaded
  echo          file at bot\config\config.yaml.
  echo.
  pause
  exit /b 1
)

echo  [OK] Config found: bot\config\config.yaml
echo.

REM  --- Start the bot ---
echo  Starting monitoring...
echo  ----------------------------------------------------------------------------

pushd "%BOT_DIR%"
call npm run bot -- --config config/config.yaml
set EXIT_CODE=%errorlevel%
popd

echo.
echo  ----------------------------------------------------------------------------
if %EXIT_CODE% neq 0 (
  echo  [STOPPED] Bot exited with code %EXIT_CODE%.
  echo            Check the error above — the most common causes are:
  echo              - Invalid RPC URL in config.yaml
  echo              - Executor wallet out of gas (send 0.02-0.05 ETH)
  echo              - Vault address mismatch (redeploy or fix config.yaml)
  echo.
  echo            To debug, run in a terminal:
  echo              cd bot ^&^& npm run bot -- --config config/config.yaml --dry-run
) else (
  echo  [STOPPED] Bot shut down (Ctrl+C or SIGTERM).
)
echo.

pause
endlocal