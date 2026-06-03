$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Set-Location $AppDir
py "$AppDir\app.py"
