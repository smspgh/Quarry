<#
  Set the version in package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json and Cargo.lock.
    .\scripts\bump.ps1 0.2.0    that version (must be higher than the current one)
    .\scripts\bump.ps1          the next patch version: 0.1.8 -> 0.1.9, 0.1.9 -> 0.1.10
#>
param([ValidatePattern('^(\d+\.\d+\.\d+)?$')][string]$Version = "")
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
# The updater only installs a higher version, so a release must never go backwards or repeat.
$current = (Get-Content "src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json).version
if (-not $Version) {
  $v = [version]$current
  $Version = "$($v.Major).$($v.Minor).$($v.Build + 1)"
}
if ([version]$Version -le [version]$current) { throw "Version $Version is not higher than the current $current." }
function Edit($path, $pattern, $replacement) {
  $text = [IO.File]::ReadAllText((Resolve-Path $path))
  $new = [regex]::Replace($text, $pattern, $replacement, 'Multiline')
  if ($new -eq $text) { Write-Host "$path already $Version (or no match)" }
  [IO.File]::WriteAllText((Resolve-Path $path), $new, (New-Object Text.UTF8Encoding $false))
}
Edit "package.json" '^(\s*"version":\s*")[^"]+' "`${1}$Version"
Edit "src-tauri/tauri.conf.json" '^(\s*"version":\s*")[^"]+' "`${1}$Version"
$cargo = [IO.File]::ReadAllText((Resolve-Path "src-tauri/Cargo.toml"))
$cargo = [regex]::new('^version = "[^"]+"', 'Multiline').Replace($cargo, "version = `"$Version`"", 1)
[IO.File]::WriteAllText((Resolve-Path "src-tauri/Cargo.toml"), $cargo, (New-Object Text.UTF8Encoding $false))
Push-Location src-tauri; cargo update -p quarry --offline; Pop-Location   # refresh Cargo.lock
Write-Host "Version is now $Version"
