<#
  One-step release: bump to the next patch version, commit it, build + sign + publish the installer
  to smspgh/quarry-releases, then push the source.

    .\scripts\quick-release.ps1                          notes "Release Bump"
    .\scripts\quick-release.ps1 -Notes "What changed"    your own notes for the update dialog
    .\scripts\quick-release.ps1 -Version 0.2.0           a chosen version instead of the next patch

  Stops before changing anything when the working tree has uncommitted changes, so unrelated work
  never ends up in the version commit. Stops at the first failing step; see the message for how to
  carry on without bumping again.
#>
param(
  [string]$Notes = "Release Bump",
  [ValidatePattern('^(\d+\.\d+\.\d+)?$')][string]$Version = ""
)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

if (git status --porcelain) { throw "The working tree has uncommitted changes. Commit or stash them first, then run this again." }

& "$PSScriptRoot\bump.ps1" $Version
$new = (Get-Content "src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json).version

git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "Quarry $new"
if ($LASTEXITCODE -ne 0) { throw "git commit failed." }

try {
  & "$PSScriptRoot\release.ps1" -Notes $Notes -Publish
} catch {
  throw "Publishing $new failed: $_`nThe version commit 'Quarry $new' is in place. Fix the problem, then run: .\scripts\release.ps1 -Notes `"$Notes`" -Publish; git push"
}

git push
if ($LASTEXITCODE -ne 0) { throw "Released $new, but git push failed. Run git push when you can." }
Write-Host "Quarry $new is published and pushed."
