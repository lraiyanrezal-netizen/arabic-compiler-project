@echo off
title LughatDad - web showcase
cd /d "%~dp0"
start "" http://localhost:3000
node web\server.js
pause
