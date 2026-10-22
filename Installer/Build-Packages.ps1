param([string]$Configuration='Release')
$ErrorActionPreference='Stop'; $root=(Resolve-Path "$PSScriptRoot\..").Path; $dotnet="$root\work\dotnet\dotnet.exe"
if(!(Test-Path $dotnet)){throw 'Bundled .NET SDK is missing. Run the runtime bootstrap first.'}
& $dotnet publish "$root\Launcher\KsrAutomationBrowser.Launcher.csproj" -c $Configuration -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o "$root\Portable\KSR Automation Browser\Launcher"
& $dotnet publish "$root\NativeHost\KsrAutomationBrowser.NativeHost.csproj" -c $Configuration -r win-x64 --self-contained true -p:PublishSingleFile=true -o "$root\Portable\KSR Automation Browser\NativeHost"
Copy-Item "$root\Browser","$root\Portable\KSR Automation Browser\Browser" -Recurse -Force; Copy-Item "$root\DefaultExtension","$root\Portable\KSR Automation Browser\DefaultExtension" -Recurse -Force
Copy-Item "$root\Config","$root\Portable\KSR Automation Browser\Config" -Recurse -Force
foreach($d in 'Profiles','Extensions','Downloads','Logs','CrashReports','Updates'){New-Item -ItemType Directory -Force -Path "$root\Portable\KSR Automation Browser\$d"|Out-Null}
@' 
@echo off
start "" "%~dp0Launcher\KsrAutomationBrowser.Launcher.exe"
'@ | Set-Content "$root\Portable\KSR Automation Browser\Start KSR Automation Browser.cmd" -Encoding ASCII
Compress-Archive -Path "$root\Portable\KSR Automation Browser\*" -DestinationPath "$root\outputs\KSR_Automation_Browser_Portable_x64.zip" -Force
Write-Host 'Portable package created. Use Inno Setup with Installer/KSR_Automation_Browser.iss for the installer.'
