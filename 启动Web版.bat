@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.12 或更新版本。
  pause
  exit /b 1
)
if not exist node_modules\vite\bin\vite.js (
  call npm ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo 正在启动纯静态 Web 开发服务器，不需要 Python。
echo 请在浏览器打开终端显示的地址；按 Ctrl+C 退出。
call npm run dev -- --port 5180 --strictPort --open
pause
