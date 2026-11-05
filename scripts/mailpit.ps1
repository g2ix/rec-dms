$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$tools = Join-Path $root "tools"
$exe = Join-Path $tools "mailpit.exe"
$version = "v1.33.0"

if (-not (Test-Path $exe)) {
  New-Item -ItemType Directory -Force -Path $tools | Out-Null
  $zip = Join-Path $tools "mailpit-windows-amd64.zip"
  $url = "https://github.com/axllent/mailpit/releases/download/$version/mailpit-windows-amd64.zip"
  Invoke-WebRequest -Uri $url -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $tools -Force
  Remove-Item $zip
}

Write-Host "Mailpit SMTP smtp://127.0.0.1:1025"
Write-Host "Mailpit UI   http://127.0.0.1:8025"
& $exe --smtp "127.0.0.1:1025" --listen "127.0.0.1:8025" --allowed-hosts "localhost,127.0.0.1" @args
