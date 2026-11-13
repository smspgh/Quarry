# Releasing Quarry

Source lives in the private repo `smspgh/Quarry`. Installers are published to the **public** repo
`smspgh/quarry-releases`, because the in-app updater downloads anonymously and a private repo's assets would 404.

## One-time setup (done)
- Signing key: `~/.tauri/quarry.key` (private, no password) and `quarry.key.pub`. The public key is in
  `src-tauri/tauri.conf.json` > `plugins.updater.pubkey`. **Back up the private key.** Installed copies accept only
  updates signed with it; if it is lost, users must reinstall by hand.
- Updater endpoint: `https://github.com/smspgh/quarry-releases/releases/latest/download/latest.json`.

## Cutting a release (exact commands, PowerShell, from the repo root)
```powershell
cd C:\coding_projects\Quarry

# 1. Set the new version everywhere (package.json, Cargo.toml, tauri.conf.json, Cargo.lock). Must be higher than the current version; the script refuses anything else.
.\scripts\bump.ps1 0.1.2

# 2. Commit (push to the private repo whenever you like)
git add -A
git commit -m "Quarry 0.1.2"
git push

# 3. Build + sign only. Nothing is uploaded. Output: release-out\
.\scripts\release.ps1 -Notes "What changed in this version"

# 4. Run release-out\Quarry_0.1.2_x64-setup.exe and check it works.

# 5. Publish: rebuilds, then creates release v0.1.2 in smspgh/quarry-releases (installer, .sig, latest.json)
.\scripts\release.ps1 -Notes "What changed in this version" -Publish
```
Check it landed: `gh release view v0.1.2 --repo smspgh/quarry-releases`, and open
`https://github.com/smspgh/quarry-releases/releases/latest/download/latest.json` (its `version` must be the new one).
The script refuses to publish a version that already exists in the releases repo, or one that is not higher than its latest release. To retract a bad release:
`gh release delete v0.1.2 --repo smspgh/quarry-releases --cleanup-tag --yes` (copies that already updated keep the new version).

Installed copies check shortly after launch (Settings > Check for updates on start) or via Help > Check for Updates.
The first build containing the updater must be installed by hand; only versions after it can update themselves.

## Testing an update end to end
Install version N, publish N+1, open N and run Help > Check for Updates. Windows installs in passive mode (small progress window) and relaunches.
