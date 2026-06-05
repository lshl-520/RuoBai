@echo off
cd /d "%~dp0"

echo ========================================
echo   Install MCP Tools for AI
echo ========================================
echo.
echo This will install:
echo   1. MySQL MCP - AI can access your database
echo   2. Playwright MCP - AI can control Chrome
echo.
pause

echo.
echo [1/2] Installing MySQL MCP...
call npm install @benborla29/mcp-server-mysql --save-dev
if %errorlevel% neq 0 (
    echo FAILED! Check your internet connection.
    pause
    exit /b 1
)

echo.
echo [2/2] Installing Playwright MCP...
call npm install @playwright/mcp --save-dev
if %errorlevel% neq 0 (
    echo Playwright failed, skipping...
)

echo.
echo ========================================
echo   DONE!
echo ========================================
echo.
echo Next steps:
echo   1. Close Cowork (Claude desktop app)
echo   2. Reopen Cowork
echo   3. Select this project folder
echo   4. AI can now access your database!
echo.
pause
