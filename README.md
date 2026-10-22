# KSR Automation Browser

A Windows desktop launcher and Manifest V3 browser extension for local browser automation, with a Gemini image-download workflow and a .NET native messaging host.

Maintained by [karanrthr](https://github.com/karanrthr). This is an independent community project, not an official Google or OpenAI product.

## Status

This repository is the first public source snapshot of a locally developed application. It is under development. Public adoption, download counts and production reliability have not been established. Browser websites change frequently, so site-specific selectors may need maintenance.

## Included functionality

- WPF launcher for an isolated Chromium profile, download folders, extension loading and diagnostics.
- Gemini current-chat and library image-download flows with persisted job state, duplicate handling, pause/resume and manual-action states.
- A native messaging host with file metadata, hashing, image-header checks, folder operations and logging.
- Default configuration, extension source, basic smoke checks and legacy installer sources.

The ChatGPT and generic adapter folders are scaffolding; they do not implement complete automation adapters.

## Requirements

- Windows x64 and the .NET 8 SDK to build the desktop components.
- A compatible Chromium runtime supplied separately. This repository does not redistribute Chromium or any browser profiles.
- A signed-in Gemini session for the Gemini workflow, established manually in the isolated browser profile.

## Build

From the repository root in PowerShell:

```powershell
.\Build-Local.ps1
```

This publishes the launcher and native host into `.local-build`. Copy your Chromium runtime directory into `.local-build\Browser\Chromium`, with `chrome.exe` directly inside that directory. Copy the entire runtime, not just the executable.

Register the native host for the current Windows user and start the launcher:

```powershell
& .\.local-build\Register-Native-Host.ps1
& '.\.local-build\Start KSR Automation Browser.cmd'
```

The registration script writes the current user's Chrome native-messaging registry entry. It uses the extension ID associated with the public key in `DefaultExtension/manifest.json`. That key is an extension identity public key, not an account credential.

The start script sets `KSR_BROWSER_ROOT` for the launcher and its child browser so the native host can resolve the configuration directory.

## Development and checks

Build the project files directly; no generated solution is required:

```powershell
dotnet build .\Launcher\KsrAutomationBrowser.Launcher.csproj -c Release
dotnet build .\NativeHost\KsrAutomationBrowser.NativeHost.csproj -c Release
```

`Tests/Smoke-Test.ps1` checks a local layout including a supplied Chromium runtime. It is a presence/configuration check, not an end-to-end automation test. The legacy installer scripts under `Installer/` need packaging-path updates and a locally generated payload before use; prefer `Build-Local.ps1` for source builds.

## Data and permissions

Browser sign-ins, cookies, profiles, downloads, job state and logs remain local. The extension requests permissions for Gemini/ChatGPT tabs, downloads, local storage, scripting, notifications, navigation and native messaging. The native host can perform file operations on paths it receives; this is not a filesystem sandbox. Register it only for the intended extension and use trusted extensions in the automation profile.

Never include browser profiles, account tokens, downloaded conversations or personal images in issues or pull requests. Reproduction reports should use synthetic examples.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Useful contributions include resilient Gemini selectors, reproducible test cases, native-host hardening, packaging fixes and new documented adapters.

## License

Project source is available under the [MIT License](LICENSE). Separately obtained browser runtimes and third-party components retain their own licenses.
