# 竞品分析看板 一键启动脚本(Windows PowerShell 5.1)
# 用法: powershell -File run.ps1
$ErrorActionPreference = "Stop"

# 1) 补 PATH(Machine + User),保证能找到 python
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + `
    [System.Environment]::GetEnvironmentVariable("Path", "User")

# 2) 全程 UTF-8
$env:PYTHONUTF8 = "1"

# 3) 切到项目根目录(本脚本所在目录)
Set-Location -Path $PSScriptRoot

# 4) 依赖检查:缺 fastapi/uvicorn 则安装
#    注意:$ErrorActionPreference=Stop 下,native 命令 stderr 被重定向会触发
#    NativeCommandError 直接中断脚本,自动安装分支永远走不到 —— 探测/安装段
#    临时改为 Continue,只按 $LASTEXITCODE 判断,结束后恢复 Stop。
$__prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
python -c "import fastapi, uvicorn" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[run.ps1] 安装依赖 (pip install -r requirements.txt) ..."
    python -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[run.ps1] 依赖安装失败,请手动执行: python -m pip install -r requirements.txt"
        exit 1
    }
}
$ErrorActionPreference = $__prevEAP

# 5) 启动(端口 8916;.env 由 backend/config.py 启动时自行解析)
Write-Host "[run.ps1] 启动看板: http://127.0.0.1:8916/"
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8916
