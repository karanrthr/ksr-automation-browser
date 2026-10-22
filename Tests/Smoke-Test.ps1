param([string]$Root=(Resolve-Path "$PSScriptRoot\..").Path)
$checks=@(); function Check($name,$result){$script:checks += [pscustomobject]@{Test=$name;Result=if($result){'PASS'}else{'FAIL'}}}
Check 'Chromium executable bundled' (Test-Path "$Root\Browser\Chromium\chrome.exe")
Check 'Default extension manifest valid' ((Get-Content "$Root\DefaultExtension\manifest.json" -Raw|ConvertFrom-Json).manifest_version -eq 3)
Check 'Configuration JSON valid' ($null -ne (Get-Content "$Root\Config\profiles.json" -Raw|ConvertFrom-Json))
Check 'Native host source present' (Test-Path "$Root\NativeHost\Program.cs")
$checks | Format-Table -AutoSize; if($checks.Result -contains 'FAIL'){exit 1}
