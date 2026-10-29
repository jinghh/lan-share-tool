; Inno Setup 脚本：把 pkg 产出的单文件 exe 打成 Windows 安装包
; 构建：ISCC.exe installer\setup.iss   （需先执行 npm run build:win 产出 dist\ShareBox.exe）

#define MyAppName "LAN ShareBox"
#define MyAppVersion "1.1.0"
#define MyAppPublisher "ShareBox"
#define MyAppExeName "ShareBox.exe"
#define MyAppId "9B7A2C51-6E4D-4C8A-9F3E-2D1A5B7C8E90"

[Setup]
AppId={{#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppVerName={#MyAppName} {#MyAppVersion}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=LAN-ShareBox-Setup
; 不使用自定义图标：exe 的图标已由 rcedit 写入，安装包/卸载图标沿用默认，
; 避免不同 Inno Setup 版本对 PNG 压缩 ico 的解析差异导致编译失败
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequiredOverridesAllowed=dialog

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加选项:"; Flags: unchecked
Name: "autostart"; Description: "开机自动启动（后台驻留托盘）"; GroupDescription: "附加选项:"; Flags: unchecked

[Files]
Source: "..\dist\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "start-hidden.vbs"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--tray"
Name: "{group}\{#MyAppName} (后台静默)"; Filename: "wscript.exe"; Parameters: """{app}\start-hidden.vbs"""
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--tray"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Parameters: "--tray"; Description: "立即启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and WizardIsTaskSelected('autostart') then
  begin
    RegWriteStringValue(HKA, 'Software\Microsoft\Windows\CurrentVersion\Run',
      '{#MyAppName}', '"' + ExpandConstant('{app}') + '\{#MyAppExeName}' + '" --tray --no-open');
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  // 卸载时移除开机自启；用户数据（%APPDATA%\ShareBox）保留，避免误删上传文件
  if CurUninstallStep = usPostUninstall then
  begin
    RegDeleteValue(HKA, 'Software\Microsoft\Windows\CurrentVersion\Run', '{#MyAppName}');
  end;
end;
