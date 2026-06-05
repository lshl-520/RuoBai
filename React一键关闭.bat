chcp 65001 >nul
@echo off
title RuoBai React 关闭

echo.
echo ====================================
echo   RuoBai React 关闭中...
echo ====================================
echo.

echo [1/3] 关闭 React 前端和后端
taskkill /F /FI "WINDOWTITLE eq RuoBai React*" >nul 2>nul
taskkill /F /FI "WINDOWTITLE eq RuoBai Server*" >nul 2>nul
taskkill /F /IM node.exe >nul 2>nul
echo   OK 前端和后端已停止

echo [2/3] 关闭后台窗口
taskkill /F /FI "WINDOWTITLE eq MariaDB*" >nul 2>nul
echo   OK 后台窗口已关闭

echo [3/3] 停止数据库
taskkill /F /IM mysqld.exe >nul 2>nul
if errorlevel 1 (
    echo   - 数据库没有运行
) else (
    echo   OK 数据库已停止
)

echo.
echo ====================================
echo   全部关闭！可以放心关电脑了
echo ====================================
echo.
timeout /t 2 >nul
exit
