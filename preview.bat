@echo off
setlocal
title MadMusic - app preview

rem Double-click this to launch the MadMusic desktop app in dev mode.
rem   preview.bat            -> Tauri desktop window (pnpm app)
rem   preview.bat web        -> browser-only dev server (pnpm dev)
rem   preview.bat build      -> production build, served locally (pnpm preview)

cd /d "%~dp0"

where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm was not found on PATH. Install it with: npm install -g pnpm
  goto :hold
)

if not exist "node_modules" (
  echo Installing dependencies...
  call pnpm install || goto :hold
)

set "MODE=%~1"
if /i "%MODE%"=="web" (
  echo Starting the Vite dev server...
  call pnpm run dev
) else if /i "%MODE%"=="build" (
  echo Building, then serving the production bundle...
  call pnpm run build && call pnpm run preview
) else (
  echo Starting the MadMusic desktop app...
  call pnpm run app
)

:hold
echo.
echo Preview stopped. Press any key to close this window.
pause >nul
endlocal
