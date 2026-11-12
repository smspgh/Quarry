# Releasing Quarry

Source lives in the private repo `smspgh/Quarry`. Installers are published to the **public** repo
`smspgh/quarry-releases`, because the in-app updater downloads anonymously and a private repo's assets would 404.

## One-time setup (done)
- Signing key: `~/.tauri/quarry.key` (private, no password) and `quarry.key.pub`. The public key is in
  `src-tauri/tauri.conf.json` > `plugins.updater.pubkey`. **Back up the private key.** Installed copies accept only
  updates signed with it; if it is lost, users must reinstall by hand.
- Updater endpoint: `https://github.com/smspgh/quarry-releases/releases/latest/download/latest.json`.

## Cutting a release
1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` (all three equal, higher than the last release). Commit.
2. `.\scripts\release.ps1 -Notes "What changed"` builds, signs, and writes `release-out\` (installer, `.sig`, `latest.json`). Nothing is uploaded.
3. Install `release-out\Quarry_<v>_x64-setup.exe` and sanity-check it.
4. `.\scripts\release.ps1 -Notes "What changed" -Publish` creates GitHub release `v<v>` in `quarry-releases` (rebuilds, then uploads).

Installed copies check shortly after launch (Settings > Check for updates on start) or via Help > Check for Updates.
The first build containing the updater must be installed by hand; only versions after it can update themselves.

## Testing an update end to end
Install version N, publish N+1, open N and run Help > Check for Updates. Windows installs in passive mode (small progress window) and relaunches.
