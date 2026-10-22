param([ValidateSet('Debug', 'Release')][string]$Configuration = 'Release')
$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot
$outputRoot = Join-Path $repoRoot '.local-build'
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

& dotnet publish (Join-Path $repoRoot 'Launcher\KsrAutomationBrowser.Launcher.csproj') -c $Configuration -r win-x64 --self-contained true '-p:AssemblyName=KSR Automation Browser' -o $outputRoot
if ($LASTEXITCODE -ne 0) { throw 'Launcher publish failed.' }
& dotnet publish (Join-Path $repoRoot 'NativeHost\KsrAutomationBrowser.NativeHost.csproj') -c $Configuration -r win-x64 --self-contained true '-p:AssemblyName=KSR Automation Native Host' -o (Join-Path $outputRoot 'NativeHost')
if ($LASTEXITCODE -ne 0) { throw 'Native host publish failed.' }

foreach ($folder in @('Config', 'DefaultExtension')) {
    $target = Join-Path $outputRoot $folder
    if (!(Test-Path -LiteralPath $target)) {
        Copy-Item -LiteralPath (Join-Path $repoRoot $folder) -Destination $target -Recurse
    } else {
        Write-Host "Keeping existing $folder. Copy updates manually after backing up local settings."
    }
}
Copy-Item -LiteralPath (Join-Path $repoRoot 'Register-Native-Host.ps1') -Destination $outputRoot -Force
@'
@echo off
set "KSR_BROWSER_ROOT=%~dp0"
start "" "%~dp0KSR Automation Browser.exe"
'@ | Set-Content -LiteralPath (Join-Path $outputRoot 'Start KSR Automation Browser.cmd') -Encoding ascii
Write-Host 'Build complete. Supply Browser\Chromium, then register the native host and use the start script. See README.md.'
