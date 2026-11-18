# Releasing Quarry

Source and releases both live in `smspgh/Quarry`. The repo must be **public**: the in-app updater downloads
`latest.json` and the installer without signing in, so a private repo's release files would be a 404 for every installed
copy. `release.ps1` checks this and refuses to publish to a repo that is not public.

Until 0.1.10, releases went to the separate repo `smspgh/quarry-releases`. Releases up to 0.1.18 also posted a bridge
`latest.json` there; the last one, **v0.1.18, must stay**: copies of 0.1.10 and earlier still read that repo, update
to 0.1.18 from it, and from then on look in `smspgh/Quarry` themselves. Nothing new is published there.

## One-time setup (done)
- Signing key: `~/.tauri/quarry.key` (private, no password) and `quarry.key.pub`. The public key is in
  `src-tauri/tauri.conf.json` > `plugins.updater.pubkey`. **Back up the private key.** Installed copies accept only
  updates signed with it; if it is lost, users must reinstall by hand.
- Updater endpoint (`tauri.conf.json` > `plugins.updater.endpoints`): `https://github.com/smspgh/Quarry/releases/latest/download/latest.json`.
- `smspgh/Quarry` is public (`gh repo view smspgh/Quarry --json visibility`).

## Release (one command, from the repo root)
```powershell
.\scripts\release.ps1 "What changed"                   # next patch version (0.1.18 -> 0.1.19)
.\scripts\release.ps1                                  # asks for the notes (required)
.\scripts\release.ps1 "What changed" -Version 0.2.0    # a chosen version
```
The notes are shown in the update dialog. The script first checks that the working tree is clean, `gh` is signed in,
`smspgh/Quarry` is public and the signing key is there. Then it bumps the version (`bump.ps1`), commits the version files
as "Quarry <version>", builds and signs (`pnpm tauri build`; output in `release-out\`), creates release v<version> in
`smspgh/Quarry` (installer, `.sig`, `latest.json`) and pushes.

If the build or the upload fails, fix the problem and run the same command again: it sees that the last commit is the
version commit of an unpublished version and releases that one instead of bumping again.

Check it landed: `gh release view v0.1.19 --repo smspgh/Quarry`, and open
`https://github.com/smspgh/Quarry/releases/latest/download/latest.json` (its `version` must be the new one).
To retract a bad release: `gh release delete v0.1.19 --repo smspgh/Quarry --cleanup-tag --yes` (copies that already
updated keep the new version).

`.\scripts\bump.ps1 [version]` alone only sets the version in the four files, for when you want to commit it yourself.

Installed copies check while they start (Settings > Check for updates on start) or via Help > Check for Updates.

## Testing an update end to end
Install version N, release N+1, open N and run Help > Check for Updates. Windows installs in passive mode (small progress window) and relaunches.
