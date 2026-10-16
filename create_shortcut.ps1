$desktopPaths = @(
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path $env:USERPROFILE 'Desktop'),
    (Join-Path $env:USERPROFILE 'OneDrive\Desktop')
) | Select-Object -Unique | Where-Object { Test-Path $_ }

$projDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$targetBat = Join-Path $projDir 'UntilDo.bat'
$iconPath = Join-Path $projDir 'untildo_icon.ico'

if (-not (Test-Path $iconPath)) {
    $iconPath = Join-Path $projDir 'app_icon.ico'
}

$WshShell = New-Object -ComObject WScript.Shell

foreach ($desk in $desktopPaths) {
    $shortcutPath = Join-Path $desk 'UntilDo.lnk'
    
    # Remove existing shortcut to bust Windows link cache
    if (Test-Path $shortcutPath) {
        Remove-Item -Path $shortcutPath -Force -ErrorAction SilentlyContinue
    }

    $Shortcut = $WshShell.CreateShortcut($shortcutPath)
    $Shortcut.TargetPath = $targetBat
    $Shortcut.WorkingDirectory = $projDir
    $Shortcut.Description = 'UntilDo - Smart Daily Tasks & AI Knowledge Suite'
    if (Test-Path $iconPath) {
        $Shortcut.IconLocation = "$iconPath,0"
    }
    $Shortcut.Save()
    Write-Host "[SUCCESS] Created UntilDo shortcut at: $shortcutPath" -ForegroundColor Green
}

# Force Windows Explorer to flush icon cache & immediately reload desktop icons
try {
    $code = @'
    using System;
    using System.Runtime.InteropServices;
    public class ShellIconRefresher {
        [DllImport("shell32.dll", SetLastError = true)]
        public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);
    }
'@
    Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
    [ShellIconRefresher]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero) # SHCNE_ASSOCCHANGED
    Write-Host "[SUCCESS] Windows desktop icon cache refreshed." -ForegroundColor Cyan
} catch {
    # Fallback
}
