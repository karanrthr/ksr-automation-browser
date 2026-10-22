[Setup]
AppName=KSR Automation Browser
AppVersion=1.0.0
DefaultDirName={localappdata}\KSR Automation Browser
DefaultGroupName=KSR Automation Browser
OutputDir=..\outputs
OutputBaseFilename=KSR_Automation_Browser_Setup_x64
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=lowest
UninstallDisplayIcon={app}\Launcher\KsrAutomationBrowser.Launcher.exe
[Files]
Source: "..\Portable\KSR Automation Browser\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
[Icons]
Name: "{autodesktop}\KSR Automation Browser"; Filename: "{app}\Launcher\KsrAutomationBrowser.Launcher.exe"
Name: "{group}\KSR Automation Browser"; Filename: "{app}\Launcher\KsrAutomationBrowser.Launcher.exe"
[Code]
function ShouldSkipPage(PageID: Integer): Boolean; begin Result := False; end;
