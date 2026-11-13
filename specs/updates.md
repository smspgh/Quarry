---
area: Updates and About
prefix: UPD
---

# Updates and About

How an installed Quarry finds and installs a newer release, the About dialog, and what the release scripts and configuration must guarantee so that updating keeps working. User documentation: `docs/releasing.md` (for the maintainer) and `docs/settings.md` (the "Check for updates on start" switch).

## UPD-001: Check for updates from the Help menu

- Status: draft
- Commands: `help.checkUpdates`
- Files:
  - `src/lib/updater.ts` — `checkForUpdates(false)` (`check()`, "Quarry is up to date" / failure / "Update available" dialogs, `busy` guard)
  - `src/lib/commands.ts` — `help.checkUpdates` (loads the updater module on demand)
  - `src/components/MenuBar.tsx` — Help › Check for Updates…
  - `src/lib/dialogs.ts` — `choose`, `inform`
  - `src-tauri/src/lib.rs` — `tauri_plugin_updater` registration
  - `src-tauri/capabilities/default.json` — `updater:default` permission
- Tests: none
- Docs: `docs/releasing.md`

**As a** Quarry user
**I want** to ask whether a newer version exists
**So that** I can update when it suits me and know when I am current

```gherkin
Scenario: UPD-001.1 Already up to date
  Given the installed version is the latest published release
  When I choose Help › Check for Updates…
  Then a dialog titled "Check for Updates" says "Quarry is up to date."

Scenario: UPD-001.2 A newer release exists
  Given Quarry 0.1.7 is installed and 0.1.8 is published with the notes "Faster search"
  When I choose Help › Check for Updates…
  Then a dialog titled "Update available" says "Quarry 0.1.8 is available (you have 0.1.7)." followed by "Faster search"
  And it offers "Later" and "Install and Restart", with "Install and Restart" as the default button

Scenario: UPD-001.3 Later changes nothing
  Given the "Update available" dialog is open
  When I click "Later" or press Escape
  Then the dialog closes, nothing is downloaded and Quarry keeps running

Scenario: UPD-001.4 The check fails
  Given the computer is offline
  When I choose Help › Check for Updates…
  Then a dialog titled "Check for Updates" starts with "Couldn't check for updates." and shows the error
  And Quarry keeps running normally

Scenario: UPD-001.5 Only one check at a time
  Given a check is still running or its dialog is still open
  When I run "Check for Updates…" again from the command palette
  Then no second check starts and no second dialog appears
```

## UPD-002: Quiet update check shortly after start

- Status: draft
- Commands: none
- Files:
  - `src/App.tsx` — boot sequence: `checkForUpdates(true)` 6 seconds after the session is restored, only when `settings.autoUpdateCheck`
  - `src/lib/updater.ts` — `checkForUpdates(true)` (silent: no dialog when up to date or when the check fails)
  - `src/lib/types.ts` — `autoUpdateCheck` (default on)
  - `src/lib/actions.ts` — `sanitizeSettings` (a non-boolean `autoUpdateCheck` becomes the default)
  - `src/components/panels/SettingsPanel.tsx` — "Check for updates on start" switch
- Tests: none
- Docs: `docs/releasing.md`, `docs/settings.md`

**As a** Quarry user
**I want** Quarry to tell me about a new version by itself, and otherwise stay silent
**So that** I do not miss updates and am not bothered when there is nothing to do

```gherkin
Scenario: UPD-002.1 A newer release is offered after start
  Given "Check for updates on start" is on and a newer release is published
  When Quarry starts
  Then about 6 seconds after the session is restored the "Update available" dialog appears

Scenario: UPD-002.2 Silent when up to date
  Given "Check for updates on start" is on and the installed version is the latest
  When Quarry starts
  Then no update dialog or toast appears

Scenario: UPD-002.3 Silent when the check fails
  Given "Check for updates on start" is on and the computer is offline
  When Quarry starts
  Then no error dialog appears

Scenario: UPD-002.4 Switched off
  Given "Check for updates on start" is off and a newer release is published
  When Quarry starts
  Then no update check is made and no dialog appears
  And Help › Check for Updates… still offers the release

Scenario: UPD-002.5 The switch is read at start
  Given Quarry started with "Check for updates on start" off
  When I turn it on in Settings
  Then no check runs until the next start or until I choose Help › Check for Updates…
```

## UPD-003: Install an update and restart

- Status: draft
- Commands: none
- Files:
  - `src/lib/updater.ts` — `install` (unsaved-documents guard, `flushSession`, download toast, `stopAllClaude` / `stopAllServers`, `update.install()`, "Update failed" dialog)
  - `src/lib/actions.ts` — `needsSavePromptOnExit`, `flushSession`
  - `src/lib/claude.ts` — `stopAllClaude`
  - `src/lib/lsp.ts` — `stopAllServers`
  - `src/editor/manager.ts` — `stateOf` (length of untitled documents for the guard)
  - `src-tauri/tauri.conf.json` — `plugins.updater` (`pubkey` the download is verified against, `windows.installMode` = `passive`)
- Tests: `src/__tests__/paths.test.ts`
- Docs: `docs/releasing.md`

**As a** Quarry user
**I want** an update to install itself and bring Quarry back
**So that** I get the new version without downloading an installer by hand and without losing work

```gherkin
Scenario: UPD-003.1 Install and Restart
  Given the "Update available" dialog for 0.1.8 is open and every document is saved
  When I click "Install and Restart"
  Then a toast says "Downloading Quarry 0.1.8…"
  And after the download the installer runs with a small progress window, Quarry closes, and Quarry 0.1.8 starts
  And the folder and tabs I had open come back

Scenario: UPD-003.2 Refuses to install over unsaved changes
  Given the file tab "notes.md" has unsaved changes
  When I click "Install and Restart"
  Then a dialog titled "Save first" says "Save your changes (notes.md), then run Help › Check for Updates again."
  And nothing is downloaded and Quarry keeps running with "notes.md" still modified

Scenario: UPD-003.3 Several unsaved files
  Given 3 file tabs have unsaved changes
  When I click "Install and Restart"
  Then the "Save first" dialog says "Save your changes (3 files), then run Help › Check for Updates again."

Scenario: UPD-003.4 Untitled tabs kept by the session do not block the update
  Given "Restore session on start" is on and the only unsaved tab is a short untitled note
  When I click "Install and Restart"
  Then the update proceeds
  And the untitled note is back after the restart

Scenario: UPD-003.5 Untitled tabs block the update when the session is not restored
  Given "Restore session on start" is off and an untitled tab holds text
  When I click "Install and Restart"
  Then the "Save first" dialog appears and nothing is downloaded

Scenario: UPD-003.6 The session cannot be saved
  Given the session file cannot be written
  When I click "Install and Restart"
  Then a dialog titled "Update" says "Couldn't save the session, so the update was not started. Try again."
  And nothing is downloaded

Scenario: UPD-003.7 Download or installation fails
  Given the connection drops during the download, or the download's signature does not match
  When the update is attempted
  Then a dialog titled "Update failed" starts with "The update could not be installed." and shows the error
  And the installed version keeps running

Scenario: UPD-003.8 Background processes are stopped before the installer takes over
  Given a Claude Code conversation and language servers are running
  When the download has finished
  Then they are stopped before the installer starts
```

## UPD-004: About Quarry

- Status: draft
- Commands: `help.about`
- Files:
  - `src/lib/about.ts` — `showAbout` (version from Tauri, WebView2 major version from the user agent, "Copy Version Info", "Open Log Folder")
  - `src/lib/commands.ts` — `help.about`
  - `src/components/MenuBar.tsx` — Help › About Quarry
  - `src/lib/dialogs.ts` — `choose`
  - `src/lib/ipc.ts` — `fs.createDir` (the log folder is created when missing)
- Tests: none
- Docs: none

**As a** Quarry user reporting a problem
**I want** to see exactly which version I run and get at the crash logs
**So that** I can give precise information in a bug report

```gherkin
Scenario: UPD-004.1 Show the version
  Given Quarry 0.1.7 is installed
  When I choose Help › About Quarry
  Then a dialog titled "Quarry 0.1.7" says "A fast text, JSON and large-file editor."
  And it shows one line with the Tauri version, the WebView2 major version and "Windows 10/11"
  And it offers "Copy Version Info", "Open Log Folder" and "Close", with "Close" as the default

Scenario: UPD-004.2 Copy Version Info
  Given the About dialog is open
  When I click "Copy Version Info"
  Then the clipboard holds two lines: "Quarry 0.1.7" and the runtime line
  And a toast says "Version info copied"

Scenario: UPD-004.3 Open Log Folder
  Given the About dialog is open
  When I click "Open Log Folder"
  Then Windows File Explorer shows the folder %LOCALAPPDATA%\com.quarry.app\logs
  And the folder is created first when it did not exist

Scenario: UPD-004.4 Close
  Given the About dialog is open
  When I press Enter or Escape
  Then the dialog closes and nothing is copied or opened
```

## UPD-005: The updater only trusts the public, signed release channel

- Status: draft
- Commands: none
- Files:
  - `src-tauri/tauri.conf.json` — `plugins.updater.endpoints` (`https://github.com/smspgh/quarry-releases/releases/latest/download/latest.json`), `plugins.updater.pubkey` (minisign), `bundle.createUpdaterArtifacts`, `plugins.updater.windows.installMode`
  - `src-tauri/Cargo.toml` — `tauri-plugin-updater`
  - `src-tauri/src/lib.rs` — plugin registration
  - `src-tauri/capabilities/default.json` — `updater:default`
  - `scripts/release.ps1` — writes the `latest.json` the endpoint serves
- Tests: none
- Docs: `docs/releasing.md`

**As a** Quarry user who installed a release
**I want** updates to come only from the official public release page and to be signed by the maintainer
**So that** updating works without an account and cannot be used to install something else

```gherkin
Scenario: UPD-005.1 Updates are found without signing in
  Given an installed Quarry on a computer with no GitHub account configured
  When it checks for updates
  Then it reads latest.json from the public repository smspgh/quarry-releases and finds the newest release

Scenario: UPD-005.2 The private source repository is never contacted
  Given the source repository smspgh/Quarry is private
  When Quarry checks for or downloads an update
  Then no request goes to smspgh/Quarry and no access token is sent or stored in the application

Scenario: UPD-005.3 An installer signed with another key is rejected
  Given latest.json points at an installer whose signature was not made with the maintainer's key
  When I click "Install and Restart"
  Then the installer is not run
  And the "Update failed" dialog appears

Scenario: UPD-005.4 An equal or older version is not offered
  Given Quarry 0.1.8 is installed and latest.json says version 0.1.8
  When I choose Help › Check for Updates…
  Then the dialog says "Quarry is up to date."
```

## UPD-006: Build, sign and publish a release

- Status: draft
- Commands: none
- Files:
  - `scripts/release.ps1` — version check across the three files, signing key (`~/.tauri/quarry.key` or `$env:QUARRY_SIGNING_KEY`), `pnpm tauri build`, `release-out/` (installer, `.sig`, `latest.json`), `-Notes`, `-Publish` (`gh release create` in `smspgh/quarry-releases`, refuses an existing tag), `-Repo`
  - `src-tauri/tauri.conf.json` — `version`, `bundle.createUpdaterArtifacts`
  - `package.json` — `version`
  - `src-tauri/Cargo.toml` — `version`
- Tests: none
- Docs: `docs/releasing.md`

**As a** maintainer releasing Quarry
**I want** one script that builds, signs and optionally publishes a release, and stops on anything inconsistent
**So that** every published release can be installed by the in-app updater

```gherkin
Scenario: UPD-006.1 Build and sign without publishing
  Given package.json, src-tauri/Cargo.toml and src-tauri/tauri.conf.json all say version 0.1.8
  And the signing key exists at ~/.tauri/quarry.key
  When I run .\scripts\release.ps1 -Notes "Faster search"
  Then release-out contains Quarry_0.1.8_x64-setup.exe, Quarry_0.1.8_x64-setup.exe.sig and latest.json
  And nothing is uploaded and the script says "Not published."

Scenario: UPD-006.2 latest.json describes the release
  When the script has built version 0.1.8 with -Notes "Faster search"
  Then latest.json has version "0.1.8", notes "Faster search" and a UTC pub_date
  And its windows-x86_64 entry holds the content of the .sig file and the url https://github.com/smspgh/quarry-releases/releases/download/v0.1.8/Quarry_0.1.8_x64-setup.exe

Scenario: UPD-006.3 Mismatched versions stop the script
  Given package.json says 0.1.8 and src-tauri/Cargo.toml says 0.1.7
  When I run .\scripts\release.ps1
  Then it stops with "Version mismatch" naming the three versions
  And nothing is built

Scenario: UPD-006.4 A missing signing key stops the script
  Given there is no key at ~/.tauri/quarry.key and QUARRY_SIGNING_KEY is not set
  When I run .\scripts\release.ps1
  Then it stops with "Signing key not found" before building

Scenario: UPD-006.5 A missing signature stops the script
  Given the build produced no .sig file next to the installer
  When the script checks the build output
  Then it stops and release-out is not written

Scenario: UPD-006.6 Publish
  Given no release v0.1.8 exists in smspgh/quarry-releases
  When I run .\scripts\release.ps1 -Notes "Faster search" -Publish
  Then the release v0.1.8 titled "Quarry 0.1.8" is created in smspgh/quarry-releases with the installer, its .sig and latest.json
  And no source code is uploaded

Scenario: UPD-006.7 A version that is already published is refused
  Given the release v0.1.8 already exists in smspgh/quarry-releases
  When I run .\scripts\release.ps1 -Publish
  Then it stops with "Release v0.1.8 already exists" before building

Scenario: UPD-006.8 Uncommitted changes only warn
  Given the working tree has uncommitted changes
  When I run .\scripts\release.ps1
  Then it warns that the release will include them and continues
```

## UPD-007: Set the version number everywhere

- Status: draft
- Commands: none
- Files:
  - `scripts/bump.ps1` — rewrites `"version"` in `package.json` and `src-tauri/tauri.conf.json`, the first `version =` in `src-tauri/Cargo.toml`, then `cargo update -p quarry --offline` for `Cargo.lock`; files written as UTF-8 without BOM
  - `package.json` — `version`
  - `src-tauri/tauri.conf.json` — `version`
  - `src-tauri/Cargo.toml` — package `version`
- Tests: none
- Docs: `docs/releasing.md`

**As a** maintainer preparing a release
**I want** one command that sets the new version in every file that carries it
**So that** the versions never disagree and the updater sees an increasing number

```gherkin
Scenario: UPD-007.1 Bump the version
  Given every version file says 0.1.7
  When I run .\scripts\bump.ps1 0.1.8
  Then package.json, src-tauri/tauri.conf.json and src-tauri/Cargo.toml say 0.1.8
  And the quarry entry in src-tauri/Cargo.lock says 0.1.8
  And the script prints "Version is now 0.1.8"

Scenario: UPD-007.2 Only the package's own version changes in Cargo.toml
  Given src-tauri/Cargo.toml lists dependencies with their own version numbers
  When I run .\scripts\bump.ps1 0.1.8
  Then only the package version line is changed

Scenario: UPD-007.3 A malformed version is refused
  When I run .\scripts\bump.ps1 1.2 or .\scripts\bump.ps1 v0.1.8
  Then PowerShell rejects the argument and no file is changed

Scenario: UPD-007.4 The release script accepts the result
  Given I ran .\scripts\bump.ps1 0.1.8
  When I run .\scripts\release.ps1
  Then its version check passes
```
