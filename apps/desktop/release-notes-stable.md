Desktop installers and standalone CLI archives share one reporting engine. Downloads and setup: https://whyfull.app/download/

- macOS: choose Apple Silicon or Intel, open the DMG, and move Whyfull to Applications. Stable Mac installers are Developer ID signed and notarized.
- Windows: run the x64 installer, then launch Whyfull from Start. The installer is currently not Authenticode signed; Windows may show an unknown-publisher warning.
- Linux: choose the x64 AppImage for desktop updates, or a Debian package for manual package updates.
- CLI only: extract the archive for your OS and keep its launcher beside the runtime folder. Add the extracted directory to PATH. Node.js is included.

To install the desktop app’s CLI, open Whyfull → Install command-line tool…. Add the displayed launcher directory to PATH if needed, then run `whyfull --json`.

Stable desktop apps check for signed updates on launch and from Whyfull → Check for updates…. You choose when to install and restart. The installed desktop CLI follows those updates. CLI archives update by directory replacement; npm installations update separately with `npm install -g whyfull@latest`.

`SHA256SUMS.txt` lists checksums for every user-facing download.

Whyfull Desktop 0.0.1 is the first signed downloadable release. It packages the local disk explorer and a standalone command-line tool with the same reporting engine. The macOS installers require Developer ID signing and notarization; the Windows installer remains unsigned at the OS level.

Before publishing this draft, test the downloaded installers, first launch, and CLI reports on each supported platform. An update from a previous signed release can be tested starting with the next desktop version. The release workflow must finish its final metadata validation successfully.
