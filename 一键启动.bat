chcp 936 >nul
@echo off
title RuoBai 启动
cd /d "%~dp0"

echo.
echo ====================================
echo   RuoBai 启动中...
echo ====================================
echo.

echo [1/3] 启动数据库
tasklist /FI "IMAGENAME eq mysqld.exe" 2>NUL | find /I "mysqld.exe" >NUL
if errorlevel 1 (
    start "MariaDB" /MIN "D:\Program Files (x86)\Mysql\bin\mysqld.exe" --defaults-file="D:\Program Files (x86)\Mysql\data\my.ini"
    timeout /t 5 /nobreak >nul
    echo   OK 数据库已启动 ^(最小化在任务栏^)
) else (
    echo   OK 数据库已在运行
)

echo [2/3] 启动网站
cd /d "%~dp0server"
start "RuoBai Site" /MIN cmd /k "node server.js"
timeout /t 3 /nobreak >nul
echo   OK 网站已启动 ^(最小化在任务栏^)

echo [3/3] 打开浏览器
start "" "http://127.0.0.1:3000/"
echo   OK 浏览器已打开

echo.
echo ====================================
echo   网址: http://127.0.0.1:3000/
echo   关闭: 双击 一键关闭.bat
echo ====================================
echo.
echo 这个窗口 3 秒后自动关闭
echo （数据库和网站继续在后台运行）
timeout /t 3 >nul
exit
