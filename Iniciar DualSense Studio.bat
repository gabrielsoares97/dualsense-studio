@echo off
chcp 65001 >nul
title DualSense Studio
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao foi encontrado. Instale em https://nodejs.org e abra este arquivo de novo.
  pause
  exit /b 1
)
node server.js --abrir
if errorlevel 1 pause
