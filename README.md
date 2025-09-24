# Ultimate X Tool (Chrome Extension, MV3)

Minimal, modern, and safe helper to follow back verified followers on X.

## Install (Developer Mode)

- Go to `chrome://extensions/`
- Enable Developer mode (top right)
- Click "Load unpacked" and select this folder
- Pin the extension and open the popup

## Usage

- Open the popup and adjust Settings (Safe Mode, Max follows)
- Open the Verified Followers page (e.g. `https://x.com/username/verified_followers`)
- Click "Follow Back" in the popup

## Notes

- Safe Mode introduces human-like random delays to reduce rate-limit risk
- Works on `x.com`
- No external servers; only uses Chrome `storage` API

## Security & Privacy

- The extension runs only on `x.com` pages you visit
- No credentials are stored; only lightweight settings in `chrome.storage.sync`

## Roadmap

- Queue and backoff strategies
- UI theming toggle (light/dark)
- Error toasts and progress HUD
