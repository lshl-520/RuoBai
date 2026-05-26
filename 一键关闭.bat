chcp 65001 >nul
@echo off
title RuoBai 关闭

echo.
echo ====================================
echo   RuoBai 关闭中...
echo ====================================
echo.

echo [1/3] 停止网站
taskkill /F /IM node.exe >nul 2>nul
if errorlevel 1 (
    echo   - 网站没在运行
) else (
    echo   OK 网站已停止
)

echo [2/3] 关闭后台命令行窗口
taskkill /F /FI "WINDOWTITLE eq RuoBai Site*" >nul 2>nul
taskkill /F /FI "WINDOWTITLE eq MariaDB*" >nul 2>nul
echo   OK 后台窗口已关闭

echo [3/3] 停止数据库
taskkill /F /IM mysqld.exe >nul 2>nul
if errorlevel 1 (
    echo   - 数据库没在运行
) else (
    echo   OK 数据库已停止
)

echo.
echo ====================================
echo   全部关闭，可以放心关电脑了
echo ====================================
echo.
timeout /t 2 >nul
exit
