@echo off
echo Starting live-server...
ipconfig | findstr "IPv4"
live-server --host=0.0.0.0 --port=8080
pause
