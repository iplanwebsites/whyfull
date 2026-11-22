Desktop installers and standalone CLI archives share one reporting engine. Downloads and setup: https://whyfull.app/download/

- macOS: choose Apple Silicon or Intel, open the DMG, and move Whyfull to Applications. Stable Mac installers are Developer ID signed and notarized.
- Windows: run the x64 installer, then launch Whyfull from Start. The installer is not code-signed, so Microsoft Defender SmartScreen may say “Windows protected your PC”. Check that the file came from this release (compare its SHA-256), then choose More info → Run anyway.
- Linux: the x64 AppImage is the recommended download; make it executable and run it, and it updates itself in place. The Debian package also updates from inside the app; installing an update asks for your administrator password.
- CLI only: extract the archive for your OS and keep its launcher beside the runtime folder. Add the extracted directory to PATH. Node.js is included.

To install the desktop app’s CLI, open Whyfull → Install command-line tool…. Add the displayed launcher directory to PATH if needed, then run `whyfull --json`.

Desktop apps check for signed updates on launch and from Whyfull → Check for updates…. You choose when to install and restart. The installed desktop CLI follows those updates. CLI archives update by directory replacement; npm installations update separately with `npm install -g whyfull@latest`.

`SHA256SUMS.txt` lists checksums for every user-facing download.

The command line is free. The desktop app is free for 30 days of use, then a $19 one-time license (per person, all your computers, updates included, 30-day refund): https://whyfull.app/buy/ · Terms: https://whyfull.app/legal/
