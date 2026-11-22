This is a preview for testing. Installers include the same reporting engine and CLI as the npm package. Downloads and setup: https://whyfull.app/download/

- macOS: choose Apple Silicon or Intel, open the DMG, and move Whyfull to Applications.
- Windows: run the x64 installer, then launch Whyfull from Start. The installer is not code-signed, so Microsoft Defender SmartScreen may say “Windows protected your PC”. Check that the file came from this release (compare its SHA-256), then choose More info → Run anyway.
- Linux: the x64 AppImage is the recommended download; make it executable and run it. A Debian package is also available.
- CLI only: extract the archive for your OS and keep its launcher beside the runtime folder. Add the extracted directory to PATH. Node.js is included.

To install the desktop app’s CLI, open Whyfull → Install command-line tool…. Add the displayed launcher directory to PATH if needed, then run `whyfull --json`.

For an unsigned Mac preview, first try opening Whyfull, then open System Settings → Privacy & Security → Open Anyway and confirm opening it. Only grant the exception for a copy you trust. Apple’s instructions: https://support.apple.com/en-us/102445

Preview builds and standalone CLI archives update manually. Download a newer release and replace your installed copy. They do not follow the stable automatic-update channel.

`SHA256SUMS.txt` lists checksums for every user-facing download. npm is available separately with `npx whyfull@latest --json`; npm latest may differ from this preview.
