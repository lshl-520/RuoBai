@echo off
cd /d "%~dp0"

echo ========================================
echo   Vue + Vite Setup for RuoBai
echo ========================================
echo.
echo Installing Vue 3, Vue Router, Vite...
echo.

call npm install vue@3 vue-router@4 --save
call npm install vite @vitejs/plugin-vue --save-dev

if %errorlevel% neq 0 (
    echo FAILED! Check internet connection.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   DONE! Run: npx vite
echo ========================================
echo.
pause
