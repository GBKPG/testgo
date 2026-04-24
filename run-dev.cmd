@echo off
set ROOT=%~dp0
start "QA Lite API" /D "%ROOT%server" cmd /k npm.cmd run dev
start "QA Lite Web" /D "%ROOT%client" cmd /k npm.cmd run dev
