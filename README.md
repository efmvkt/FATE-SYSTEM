# FATE SYSTEM v0.3.2

Passive character-state observer for SillyTavern. It does not inject instructions into roleplay generation and does not modify character cards.

## Install
Install this repository through SillyTavern → Extensions → Install extension. The repository root must contain `manifest.json`, `index.js`, and `style.css`.

## Open
After Sillytavern finishes loading, a floating `✦ FATE` button should appear in the lower-right corner. Tap it to open the panel. The extension also shows a ready notification after successful initialization.

## Troubleshooting
If the button does not appear, open the browser developer console and look for `[FATE SYSTEM]`. Initialization errors are logged there and surfaced through a toast when available.

State is stored locally per chat using SillyTavern's bundled localforage when available, with localStorage fallback.
