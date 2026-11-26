# Installing Quarry

Quarry runs on **Windows 11, 64-bit (x64)**. It is free for individuals; an organization with two or more people using it needs a commercial license (see [License](../LICENSE)).

## Install

1. Open the [latest release](https://github.com/smspgh/Quarry/releases/latest).
2. Under **Assets**, download **`Quarry_<version>_x64-setup.exe`** (about 7 MB).
3. Run it and follow the two steps of the installer. Quarry starts from the Start menu.

The installer needs no administrator rights: it installs for your Windows account only, into `%LOCALAPPDATA%\Quarry`. It does not change your default apps.

### Which file is which

| File | What it is |
| --- | --- |
| `Quarry_<version>_x64-setup.exe` | The installer. This is the one you want. |
| `Quarry_<version>_x64-store-setup.exe` | The same Quarry with Microsoft's WebView2 runtime included (about 290 MB). Only needed on a PC that has no internet access and no WebView2; Windows 11 comes with WebView2. Releases from 1.0.0 on. |
| `…-setup.exe.sig`, `latest.json` | Used by Quarry's own updater. You never need to download them. |

### Checking the download

Releases from 1.0.0 on are code-signed. Right-click the downloaded file, choose **Properties › Digital Signatures**, and the signer is **Stephen Shirey**. If Windows asks whether to run the file, the publisher shown is the same name.

Windows SmartScreen can still show "Windows protected your PC" for a release that few people have downloaded yet. Check the publisher as above, then choose **More info › Run anyway**. Release 0.1.19 and earlier were not code-signed, so SmartScreen always warns about them.

## What the installer adds

- Quarry in the Start menu, and in **Settings › Apps › Installed apps**.
- **Open with Quarry** in File Explorer's right-click menu for files, and **Open folder in Quarry** for folders (on Windows 11 under **Show more options**).
- Quarry in the **Open with** list for common text, data and code files.

## Updates

Quarry looks for a new version when it starts and offers to install it. The update is downloaded from GitHub, verified against Quarry's signing key, installed in a small progress window, and Quarry restarts with your tabs. It will not update while you have unsaved changes.

- Check yourself: **Help › Check for Updates**.
- Turn the check at start off: **Settings › App › Check for updates on start**.
- See which version you have: **Help › About Quarry**.

## Uninstall

**Settings › Apps › Installed apps › Quarry › Uninstall.** This removes the app and the File Explorer entries.

Your settings, session, scripts and macros are in `%APPDATA%\com.quarry.app`, and logs in `%LOCALAPPDATA%\com.quarry.app`. Delete those two folders to remove everything Quarry stored ([Settings: Files Quarry keeps](settings.md#files-quarry-keeps)).

## Installing on many PCs

For scripted installs, run the installer silently:

```powershell
Quarry_<version>_x64-setup.exe /S
```

It still installs per user, so run it as the user who will use Quarry. An organization installing Quarry for two or more people needs commercial licenses: see [License](../LICENSE).

## Help

- Questions and bug reports: **Help › Report a Problem…**, or [open an issue](https://github.com/smspgh/Quarry/issues). **Help › About Quarry › Copy Version Info** gives the details worth including.
- Licensing: smspgh@outlook.com.
- Privacy: Quarry collects no personal information. [Privacy policy](https://smspgh.github.io/Quarry/privacy.html).
