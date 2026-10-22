$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$hostPath = Join-Path $root 'NativeHost\KSR Automation Native Host.exe'
$manifestPath = Join-Path $root 'NativeHost\com.ksr.automation.json'
if (-not (Test-Path -LiteralPath $hostPath)) { throw "Native host missing: $hostPath" }
$manifest = [ordered]@{
    name = 'com.ksr.automation'
    description = 'KSR Automation Native Host'
    path = $hostPath
    type = 'stdio'
    allowed_origins = @('chrome-extension://edhdnbpcgeaojeikleephdafmcbbaaen/')
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding utf8
$key = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.ksr.automation'
New-Item -Path $key -Force | Out-Null
Set-Item -Path $key -Value $manifestPath
