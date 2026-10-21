$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '请先安装 Node.js 22.12+ 或 24 LTS。' }
if (-not (Test-Path -LiteralPath 'node_modules')) {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw '依赖安装失败，请检查网络后重试。' }
}
Write-Host '班薪记启动后，在浏览器打开 http://localhost:5173 。手机与电脑同网络时，可使用 Vite 显示的 Network 地址。'
npm run dev -- --port 5173 --strictPort
