@echo off
REM ---------------------------------------------------------------------------
REM  SafeGPT - local self-hosted build.
REM  Double-click this file, or run "start.bat" from a terminal.
REM
REM  Starts the interface on http://localhost:5173 and opens your browser.
REM
REM  There is no API key to configure. This repository has no AI features:
REM  the ChainGPT integration lives in safegpt-platform. The only optional
REM  setting is VITE_ALCHEMY_API_KEY, for a faster token scan.
REM ---------------------------------------------------------------------------

setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is required but was not found on your PATH.
  echo   Install it from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  if not exist ".env.example" (
    echo.
    echo   .env.example is missing. Re-clone the repository.
    echo.
    pause
    exit /b 1
  )
  copy /y ".env.example" ".env" >nul
  echo.
  echo   Created .env from .env.example.
  echo   Optional: add VITE_ALCHEMY_API_KEY for a faster token scan.
  echo.
)

REM  node_modules is required before the launcher can start Vite. Without this
REM  check the launcher fails later with a bare ENOENT and the window closes
REM  before the user can read it.
if not exist "web\node_modules" (
  echo.
  echo   Dependencies are not installed. Installing now...
  pushd web
  call npm install
  if errorlevel 1 (
    popd
    echo.
    echo   npm install failed. See the output above.
    echo.
    pause
    exit /b 1
  )
  popd
)

echo   Installing dependencies if needed...
pushd web
call npm install --silent
if errorlevel 1 (
  popd
  echo.
  echo   npm install failed. See the output above.
  echo.
  pause
  exit /b 1
)

call npm run start:local
set EXIT_CODE=%errorlevel%
popd

if %EXIT_CODE% neq 0 (
  echo.
  echo   The dev server exited with code %EXIT_CODE%.
  echo   If you cannot read the error above, run the same command in a terminal:
  echo     cd web ^&^& npm run dev
  echo.
  pause
  exit /b %EXIT_CODE%
)

endlocal