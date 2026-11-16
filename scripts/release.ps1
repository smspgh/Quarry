<#
  Build, sign and (optionally) publish a Quarry release.

    .\scripts\release.ps1                          build + sign + write release-out\ (nothing is uploaded)
    .\scripts\release.ps1 -Notes "What changed"    same, with release notes shown in the update dialog
    .\scripts\release.ps1 -Publish                 also create the GitHub release in smspgh/Quarry

  Bump the version first (package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json: all three must match).
  The signing key is read from ~/.tauri/quarry.key (override with $env:QUARRY_SIGNING_KEY); back it up, because
  installed copies only accept updates signed with it.

  Releases go to the source repo smspgh/Quarry, which must be public: the in-app updater downloads latest.json
  and the installer without signing in. Copies of 0.1.10 and earlier look for updates in the old releases repo,
  so latest.json (pointing at the installer in smspgh/Quarry) is also published there as a release of the same
  version. Pass -LegacyRepo "" once no such copies are left.
#>
param(
  [string]$Notes = "",
  [switch]$Publish,
  [string]$Repo = "smspgh/Quarry",
  [string]$LegacyRepo = "smspgh/quarry-releases"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$conf = Get-Content "src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json
$version = $conf.version
$pkg = (Get-Content "package.json" -Raw | ConvertFrom-Json).version
$cargo = [regex]::Match((Get-Content "src-tauri/Cargo.toml" -Raw), '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value
if ($pkg -ne $version -or $cargo -ne $version) { throw "Version mismatch: tauri.conf.json $version, package.json $pkg, Cargo.toml $cargo" }
if (git status --porcelain) { Write-Warning "Working tree has uncommitted changes; the release will include them." }

$key = if ($env:QUARRY_SIGNING_KEY) { $env:QUARRY_SIGNING_KEY } else { Join-Path $HOME ".tauri/quarry.key" }
if (-not (Test-Path $key)) { throw "Signing key not found: $key" }
$env:TAURI_SIGNING_PRIVATE_KEY = (Resolve-Path $key).Path
if ($null -eq $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "" }

if ($Publish) {
  # The updater cannot sign in: a private repo's release files would be a 404 for every installed copy.
  $visibility = gh repo view $Repo --json visibility -q .visibility 2>$null
  if ($LASTEXITCODE -ne 0) { throw "Cannot read $Repo with gh (is gh signed in?)." }
  if ($visibility -ne "PUBLIC") { throw "$Repo is $visibility. Installed copies download updates without signing in, so releases must go to a public repository. Make $Repo public first (gh repo edit $Repo --visibility public --accept-visibility-change-consequences)." }
  if ($LegacyRepo) {
    gh release view "v$version" --repo $LegacyRepo 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { throw "Release v$version already exists in $LegacyRepo. Bump the version." }
  }
  gh release view "v$version" --repo $Repo 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { throw "Release v$version already exists in $Repo. Bump the version." }
  # Installed copies ignore a release that is not newer than the one they have.
  $latest = gh release view --repo $Repo --json tagName -q .tagName 2>$null
  if ($LASTEXITCODE -eq 0 -and $latest -and ([version]($latest -replace '^v', '') -ge [version]$version)) {
    throw "Version $version is not higher than the latest release $latest in $Repo. Bump the version."
  }
  $global:LASTEXITCODE = 0
}

pnpm tauri build
if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }

$setup = "src-tauri/target/release/bundle/nsis/Quarry_${version}_x64-setup.exe"
if (-not (Test-Path $setup) -or -not (Test-Path "$setup.sig")) { throw "Missing $setup or its .sig (is createUpdaterArtifacts on and the key set?)" }

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

if (-not $Publish) { Write-Host "Not published. Test the installer, then re-run with -Publish (or upload release-out\* yourself)."; return }

$title = "Quarry $version"
$body = if ($Notes) { $Notes } else { $title }
gh release create "v$version" --repo $Repo --title $title --notes $body (Join-Path $out "Quarry_${version}_x64-setup.exe") (Join-Path $out "Quarry_${version}_x64-setup.exe.sig") (Join-Path $out "latest.json")
if ($LASTEXITCODE -ne 0) { throw "gh release create failed" }
Write-Host "Published v$version to https://github.com/$Repo/releases"

# Older installed copies read latest.json from the old releases repo: give them the same file (its url points at
# the installer in $Repo), so they update to this version, which then looks in $Repo itself.
if ($LegacyRepo) {
  gh release create "v$version" --repo $LegacyRepo --title $title --notes "$body`n`nQuarry's releases have moved to https://github.com/$Repo/releases" (Join-Path $out "latest.json")
  if ($LASTEXITCODE -ne 0) { throw "Published to $Repo, but the bridge release in $LegacyRepo failed: older copies will not see v$version. Run: gh release create v$version --repo $LegacyRepo --title `"$title`" --notes `"moved`" release-out\latest.json" }
  Write-Host "Bridge: latest.json for v$version also in https://github.com/$LegacyRepo/releases"
}
