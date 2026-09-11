@echo off
title GatedSpace Dev
cd /d "C:\Dev\superset\apps\desktop"

REM Clear any leftover Electron from a previous run BEFORE starting.
REM Only electron.exe. GatedSpace.exe is the installed app and is never touched.
REM
REM This is the whole reason this launcher exists: killing the dev Electron
REM without stopping electron-vite leaves a bare electron.exe behind, and
REM clicking that (or its taskbar entry) launches Electron with no app, which
REM is the "electron.exe path-to-app" welcome screen.
taskkill /IM electron.exe /F >nul 2>&1

REM Always log. The shortcut runs this with the console hidden, so without a
REM file there is no way to find out why a launch failed — which already cost
REM one debugging round against a window that was simply black.
call bun run dev > "C:\Dev\superset\apps\desktop\dev-instance.log" 2>&1

REM And clean up on the way out, so closing the window cannot leave debris.
taskkill /IM electron.exe /F >nul 2>&1
