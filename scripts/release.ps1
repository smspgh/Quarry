<#
  Release Quarry: bump to the next patch version, commit it as "Quarry <version>", build, sign, publish the
  installer as a release of smspgh/Quarry, then push.

    .\scripts\release.ps1 "What changed"                   notes shown in the update dialog
    .\scripts\release.ps1                                  asks for the notes (they are required)
    .\scripts\release.ps1 "What changed" -Version 0.2.0    a chosen version instead of the next patch

  Everything is checked before anything changes: a clean working tree, gh signed in, smspgh/Quarry public (the
  in-app updater downloads without signing in), the signing key (~/.tauri/quarry.key, or $env:QUARRY_SIGNING_KEY;
  back it up: installed copies only accept updates signed with it).

  If the build or the upload fails after the version commit, run the same command again: it sees that the last
  commit is "Quarry <version>" for a version not published yet and carries on with it instead of bumping again.
#>
param(
  [Parameter(Position = 0)][string]$Notes = "",
  [ValidatePattern('^(\d+\.\d+\.\d+)?$')][string]$Version = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$Repo = "smspgh/Quarry"

# ---- notes (required)
while (-not $Notes.Trim()) {
  $Notes = Read-Host "Release notes (shown in the update dialog)"
}
$Notes = $Notes.Trim()

# ---- checks before anything changes
if (git status --porcelain) { throw "The working tree has uncommitted changes. Commit or stash them first, then run this again." }

$visibility = gh repo view $Repo --json visibility -q .visibility 2>$null
if ($LASTEXITCODE -ne 0) { throw "Cannot read $Repo with gh (is gh signed in?)." }
# The updater cannot sign in: a private repo's release files would be a 404 for every installed copy.
if ($visibility -ne "PUBLIC") { throw "$Repo is $visibility. Installed copies download updates without signing in, so releases must go to a public repository. Make $Repo public first (gh repo edit $Repo --visibility public --accept-visibility-change-consequences)." }

$key = if ($env:QUARRY_SIGNING_KEY) { $env:QUARRY_SIGNING_KEY } else { Join-Path $HOME ".tauri/quarry.key" }
if (-not (Test-Path $key)) { throw "Signing key not found: $key" }
$env:TAURI_SIGNING_PRIVATE_KEY = (Resolve-Path $key).Path
if ($null -eq $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "" }

function Get-Versions {
  $conf = (Get-Content "src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json).version
  $pkg = (Get-Content "package.json" -Raw | ConvertFrom-Json).version
  $cargo = [regex]::Match((Get-Content "src-tauri/Cargo.toml" -Raw), '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value
  if ($pkg -ne $conf -or $cargo -ne $conf) { throw "Version mismatch: tauri.conf.json $conf, package.json $pkg, Cargo.toml $cargo" }
  $conf
}
function Test-Released($v) {
  gh release view "v$v" --repo $Repo 2>$null | Out-Null
  $found = $LASTEXITCODE -eq 0
  $global:LASTEXITCODE = 0
  $found
}

# ---- version: carry on with an unpublished version commit, else bump and commit
$current = Get-Versions
$resume = ((git log -1 --format=%s) -eq "Quarry $current") -and -not (Test-Released $current) -and (-not $Version -or $Version -eq $current)
if ($resume) {
  $version = $current
  Write-Host "The last commit is 'Quarry $version', which is not published yet: releasing it (no new bump)."
} else {
  & "$PSScriptRoot\bump.ps1" $Version
  $version = Get-Versions
  if (Test-Released $version) {
    git checkout -- package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
    throw "Release v$version already exists in $Repo. Choose a higher version with -Version."
  }
  git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
  git commit -q -m "Quarry $version"
  if ($LASTEXITCODE -ne 0) { throw "git commit failed." }
}
# Installed copies ignore a release that is not newer than the one they have.
$latest = gh release view --repo $Repo --json tagName -q .tagName 2>$null
if ($LASTEXITCODE -eq 0 -and $latest -and ([version]($latest -replace '^v', '') -ge [version]$version)) {
  throw "Version $version is not higher than the latest release $latest in $Repo. Run again with a higher -Version."
}
$global:LASTEXITCODE = 0
$retry = "The version commit 'Quarry $version' is in place: fix the problem and run .\scripts\release.ps1 again (it will not bump again)."

# ---- build and sign
pnpm tauri build
if ($LASTEXITCODE -ne 0) { throw "tauri build failed. $retry" }

$setup = "src-tauri/target/release/bundle/nsis/Quarry_${version}_x64-setup.exe"
if (-not (Test-Path $setup) -or -not (Test-Path "$setup.sig")) { throw "Missing $setup or its .sig (is createUpdaterArtifacts on and the key set?). $retry" }

$out = Join-Path $root "release-out"
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory $out | Out-Null
Copy-Item $setup, "$setup.sig" $out

$manifest = [ordered]@{
  version  = $version
  notes    = $Notes
  pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = (Get-Content "$setup.sig" -Raw).Trim()
      url       = "https://github.com/$Repo/releases/download/v$version/Quarry_${version}_x64-setup.exe"
    }
  }
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $out "latest.json") -Encoding utf8
Write-Host "Built Quarry $version -> $out"

# ---- publish
gh release create "v$version" --repo $Repo --title "Quarry $version" --notes $Notes (Join-Path $out "Quarry_${version}_x64-setup.exe") (Join-Path $out "Quarry_${version}_x64-setup.exe.sig") (Join-Path $out "latest.json")
if ($LASTEXITCODE -ne 0) { throw "gh release create failed. $retry" }
Write-Host "Published v$version to https://github.com/$Repo/releases"

# ---- push
git push
if ($LASTEXITCODE -ne 0) { throw "Released $version, but git push failed. Run git push when you can." }
Write-Host "Quarry $version is published and pushed."
