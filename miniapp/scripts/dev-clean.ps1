$ErrorActionPreference = 'Stop'

$miniappRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$normalizedRoot = $miniappRoot.TrimEnd('\')

Write-Host 'Stopping existing miniapp Taro watchers...'
$watchers = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'node.exe' -and
  $_.CommandLine -and
  $_.CommandLine.IndexOf($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
  $_.CommandLine -match 'taro' -and
  $_.CommandLine -match '--watch'
}

foreach ($watcher in $watchers) {
  Write-Host "  stopping PID $($watcher.ProcessId)"
  Stop-Process -Id $watcher.ProcessId -Force -ErrorAction SilentlyContinue
}

if ($watchers) {
  Start-Sleep -Milliseconds 500
}

$distPath = Join-Path $miniappRoot 'dist'
if (Test-Path -LiteralPath $distPath) {
  $resolvedDist = (Resolve-Path -LiteralPath $distPath).Path
  $expectedDist = [System.IO.Path]::GetFullPath($distPath)
  if (-not $resolvedDist.Equals($expectedDist, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean unexpected path: $resolvedDist"
  }
  Write-Host 'Cleaning generated dist...'
  Remove-Item -LiteralPath $resolvedDist -Recurse -Force
}

$env:NODE_ENV = 'development'
if (-not $env:TARO_APP_API_BASE) {
  $env:TARO_APP_API_BASE = 'http://127.0.0.1:3000'
}

Write-Host "Starting one Taro watcher for $miniappRoot"
& (Join-Path $miniappRoot 'node_modules\.bin\taro.cmd') build --type weapp --watch --env development
exit $LASTEXITCODE
