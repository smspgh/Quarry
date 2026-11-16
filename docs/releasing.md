# Releasing Quarry

Source and releases both live in `smspgh/Quarry`. The repo must be **public**: the in-app updater downloads
`latest.json` and the installer without signing in, so a private repo's release files would be a 404 for every installed
copy. `release.ps1 -Publish` checks this and refuses to publish to a repo that is not public.

Until 0.1.10, releases went to the separate public repo `smspgh/quarry-releases`, and copies of 0.1.10 and earlier still
look for updates there. So every release also posts its `latest.json` (whose download URL points at the installer in
`smspgh/Quarry`) as a release of the same version in `smspgh/quarry-releases`: those copies update to it, and from then
on look in `smspgh/Quarry` themselves. Once no such copies are left, pass `-LegacyRepo ""` (or remove the default).

## One-time setup (done)
- Signing key: `~/.tauri/quarry.key` (private, no password) and `quarry.key.pub`. The public key is in
  `src-tauri/tauri.conf.json` > `plugins.updater.pubkey`. **Back up the private key.** Installed copies accept only
  updates signed with it; if it is lost, users must reinstall by hand.
- Updater endpoint (`tauri.conf.json` > `plugins.updater.endpoints`): `https://github.com/smspgh/Quarry/releases/latest/download/latest.json`.
- `smspgh/Quarry` is public (`gh repo view smspgh/Quarry --json visibility`).

## Quick release (one command)
```powershell
.\scripts\quick-release.ps1                          # next patch version (0.1.9 -> 0.1.10), notes "Release Bump"
.\scripts\quick-release.ps1 -Notes "What changed"    # your own notes for the update dialog
.\scripts\quick-release.ps1 -Version 0.2.0           # a chosen version
```
It bumps the version, commits the version files as "Quarry <version>", builds, signs and publishes the installer
(`release.ps1 -Publish`), then pushes. It refuses to start with uncommitted changes, and skips the "test the installer
first" step below. If the build or upload fails, the version commit stays; finish with
`.\scripts\release.ps1 -Notes "..." -Publish; git push` rather than running it again (that would bump once more).

## Cutting a release step by step (exact commands, PowerShell, from the repo root)
```powershell
cd C:\coding_projects\Quarry

# 1. Set the new version everywhere (package.json, Cargo.toml, tauri.conf.json, Cargo.lock). Must be higher than the current version; the script refuses anything else.
#    Leave the version out for the next patch version (0.1.1 -> 0.1.2).
.\scripts\bump.ps1 0.1.2

# 2. Commit (push to the private repo whenever you like)
git add -A
git commit -m "Quarry 0.1.2"
git push

# 3. Build + sign only. Nothing is uploaded. Output: release-out\
.\scripts\release.ps1 -Notes "What changed in this version"

# 4. Run release-out\Quarry_0.1.2_x64-setup.exe and check it works.

# 5. Publish: rebuilds, then creates release v0.1.2 in smspgh/Quarry (installer, .sig, latest.json),
#    and the bridge release v0.1.2 in smspgh/quarry-releases (latest.json only) for older copies
.\scripts\release.ps1 -Notes "What changed in this version" -Publish
```
Check it landed: `gh release view v0.1.2 --repo smspgh/Quarry`, and open
`https://github.com/smspgh/Quarry/releases/latest/download/latest.json` (its `version` must be the new one; the same
file under `smspgh/quarry-releases` too, while the bridge is on).
The script refuses to publish a version that already exists in either repo, or one that is not higher than the latest release. To retract a bad release:
`gh release delete v0.1.2 --repo smspgh/Quarry --cleanup-tag --yes` and `gh release delete v0.1.2 --repo smspgh/quarry-releases --cleanup-tag --yes` (copies that already updated keep the new version).

Installed copies check shortly after launch (Settings > Check for updates on start) or via Help > Check for Updates.
The first build containing the updater must be installed by hand; only versions after it can update themselves.

## Testing an update end to end
Install version N, publish N+1, open N and run Help > Check for Updates. Windows installs in passive mode (small progress window) and relaunches.
