@echo off
chcp 936 >NUL
title RuoBai React Close

echo.
echo   Closing...

taskkill /F /IM node.exe >NUL 2>NUL
taskkill /F /IM mysqld.exe >NUL 2>NUL

echo   All closed!
timeout /t 2 >NUL

REM close all RuoBai windows
taskkill /F /FI "WINDOWTITLE eq RuoBai*" >NUL 2>NUL
exit
