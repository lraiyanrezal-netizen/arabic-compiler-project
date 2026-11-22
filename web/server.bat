@echo off
rem headless server (no browser) - used for testing / background runs
cd /d "%~dp0.."
node web\server.js
