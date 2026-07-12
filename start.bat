@echo off
chcp 65001 >nul
title 朋友聊天室

echo.
echo    ╔══════════════════════════════╗
echo    ║       朋友聊天室 v2           ║
echo    ║   React + Express + WebSocket ║
echo    ╚══════════════════════════════╝
echo.

cd /d "%~dp0"

REM 确保 Node.js 在 PATH 中
set "PATH=E:\Nodejs;%PATH%"

REM 检查 node 是否可用
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo    [错误] 找不到 Node.js，请确认已安装 Node.js
    echo    下载地址: https://nodejs.org
    pause
    exit /b 1
)

REM 检查是否已安装依赖
if not exist "node_modules" (
    echo    [首次运行] 正在安装后端依赖...
    call npm install
)
if not exist "client\node_modules" (
    echo    [首次运行] 正在安装前端依赖...
    cd client && call npm install && cd ..
)
if not exist "client\dist" (
    echo    [首次运行] 正在构建前端...
    cd client && call npm run build && cd ..
)

echo    启动服务器...
echo.
echo    用户端: http://localhost:3000
echo    管理后台: http://localhost:3000/admin
echo.
echo    按 Ctrl+C 停止服务器
echo ═══════════════════════════════════

start http://localhost:3000
node server.js
pause
