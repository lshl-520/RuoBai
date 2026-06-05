chcp 65001 >nul
@echo off
title RuoBai React 启动
cd /d "%~dp0"

echo.
echo ====================================
echo   RuoBai React 前端启动中...
echo ====================================
echo.

echo [1/4] 检查数据库
tasklist /FI "IMAGENAME eq mysqld.exe" 2>NUL | find /I "mysqld.exe" >NUL
if errorlevel 1 (
    start "MariaDB" /MIN "D:\Program Files (x86)\Mysql\bin\mysqld.exe" --defaults-file="D:\Program Files (x86)\Mysql\data\my.ini"
    timeout /t 5 /nobreak >nul
    echo   OK 数据库已启动
) else (
    echo   OK 数据库已在运行
)

echo [2/4] 启动后端
tasklist /FI "WINDOWTITLE eq RuoBai Server*" 2>NUL | find /I "cmd.exe" >NUL
if errorlevel 1 (
    cd /d "%~dp0server"
    start "RuoBai Server" /MIN cmd /k "node server.js"
    timeout /t 3 /nobreak >nul
    echo   OK 后端已启动 (端口 3000)
) else (
    echo   OK 后端已在运行
)

echo [3/4] 启动 React 前端
cd /d "%~dp0frontend-react"
start "RuoBai React" cmd /k "npx vite"
timeout /t 5 /nobreak >nul
echo   OK React 前端已启动 (端口 4175)

echo [4/4] 打开浏览器
start "" "http://127.0.0.1:4175/"
echo   OK 浏览器已打开

echo.
echo ====================================
echo   React 前端: http://127.0.0.1:4175/
echo   后端 API:   http://127.0.0.1:3000/
echo   关闭: 双击 React一键关闭.bat
echo ====================================
echo.
echo 此窗口将在 3 秒后自动关闭
echo 数据库、后端和React前端都在后台运行！
timeout /t 3 >nul
exit
