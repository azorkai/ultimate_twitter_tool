# Ultimate X Tool (Chrome Extension, MV3)

Minimal, modern, and safe helper for X. Primary goal: follow back verified followers with human‑like pacing. Built with plain MV3 modules; no build step.

## Features

- **Follow Back (Verified Followers)**: Safe, incremental follow actions with progress and pause/cancel controls.
- **Safe Mode**: Human‑like random delays to reduce rate‑limit risk.
- **Favorites (Profiles)**: Save profiles to a local list and open them quickly from the popup.
- **Engage (Experimental)**: Configure an engagement type and max actions, open a relevant feed, and dispatch a start event (WIP).
- **Ad Blocker (New)**: Blocks promoted ads on X with three modes — Remove, Message, or Chill (replaces ads with cute cat photos). Optional floating panel with ON/OFF and a live counter.
- **Keyboard navigation**: Use `←` / `→` to switch popup pages. Minimal paginator with dots and arrows.
- **Privacy‑first**: No external servers; only uses Chrome storage.

## Install (Developer Mode)

1. Open `chrome://extensions/`
2. Enable Developer mode (top right)
3. Click “Load unpacked” and select this repository folder
4. Pin the extension and open the popup

Works on Chromium‑based browsers that support MV3 (Chrome, Edge, Brave).

## Quick Start

1. In the popup Home tab, set your X `username`.
2. Go to the **Follow Back** tab:
   - Toggle **Safe Mode** as preferred
   - Pick **Max follows** per run
   - Click **Follow Back**
3. The tool opens `https://x.com/<username>/verified_followers`, waits for the page, and starts.
4. Use **Pause/Resume** or **Cancel** from the popup at any time.

### Ad Blocker

1. Open the popup → click **Settings** to open the options page.
2. Go to the **Ad Blocker** tab:
   - Toggle **Enable Ad Blocker**
   - Toggle **Show Floating Panel** (shows a small bottom‑right control on pages)
   - Choose **Block Mode**:
     - `Remove completely`: hides ads entirely
     - `Show blocked message`: keeps a placeholder
     - `Chill mode (cats)`: replaces ad blocks with cat photos
   - View **Stats** for blocked count and last time
   - Click **Force refresh** to rescan the current X tabs immediately
3. Browse `https://x.com`; the content script will continuously detect and block ads while you scroll.

## How it works

- The popup routes between `Home`, `Follow Back`, `Engage`, and `Favorites` pages.
- When you click Follow Back, the popup stores intent and navigates the active tab to your `verified_followers` page. Once loaded, a content script runs the flow and updates progress via `chrome.storage.local`.
- Events used:
  - `UTT_START_FOLLOW_BACK`, `UTT_TOGGLE_PAUSE`, `UTT_CANCEL` (popup → content)
  - Progress state is mirrored to `followProgress` in local storage for UI.
- The paginator at the bottom provides compact navigation; arrow keys are also supported.

### Ad Blocker internals

- Content script: `src/content/ad-blocker.js` runs on `x.com`.
- Persists settings and stats to `chrome.storage.local`:
  - `adBlockerEnabled`, `adBlockerPanelEnabled`, `removeAdsCompletely`, `chillModeEnabled`
  - `blockedAdsCount`, `lastBlockedTime`
- Detects ads by multiple signals: `data-testid="promoted-badge"`, attributes (e.g. `data-promoted`), role wrappers, and visible labels (e.g. “Ad”, “Promoted”).
- Optional floating panel shows ON/OFF and blocked counter; you can toggle it from Options.
- Options page sends messages to all open `x.com` tabs to apply changes instantly (enable/disable, panel visibility, mode, force refresh).

## Permissions

- `storage`: Save lightweight settings and progress state
- `tabs`: Open/update current tab to the verified followers page
- `scripting`: Inject custom events used for coordination
- `host_permissions`: `https://x.com/*` only

Notes for Ad Blocker:
- Uses only `chrome.storage.local` for settings and counters.
- Does not make network requests to third‑party services.

## Security & Privacy

- Runs only on `x.com` pages. No external requests to third‑party servers.
- No credentials stored. Only minimal configuration in `chrome.storage.sync` and ephemeral run state in `chrome.storage.local`.

## Favorites

- Add/remove favorites from X via the injected profile button (content scripts).
- View the list in the popup under `Favorites`, open profiles in new tabs, or clear the list.

## Engage (Experimental)

- Configure an engage type (e.g., likes/retweets) and a max per run.
- The popup opens a relevant search feed and dispatches `UTT_START_ENGAGE` for a future worker. Functionality is a stub for now.

## Troubleshooting

- **Nothing happens after clicking Follow Back**
  - Ensure your username is set in the Home tab.
  - Confirm you are navigated to `https://x.com/<username>/verified_followers`.
  - Keep the X tab active until the run begins.
- **Buttons not detected**
  - The tool targets actionable follow/follow‑back controls in the main area and skips sidebars. Scroll a bit and try again.
- **Stuck in Paused/Idle**
  - Click Pause/Resume once more. If still stuck, click Cancel and start again.
- **Debugging**
  - Open DevTools on the X tab and check the Console for `[UTT]` logs. The popup enables temporary debug logs automatically at start.
  - For Ad Blocker, look for `[UTT][ADBLOCK]` logs. Use Options → Force refresh if the page layout changes.

## Development

- Plain ES Modules; no bundler, no build step. Load the folder as unpacked.
- Key files/directories:
  - `src/content/verified-followers.js`: main follow‑back worker
  - `src/content/ad-blocker.js`: ad blocker content script and floating panel
  - `src/popup/`: popup UI (pages, router, styles)
  - `src/background/service-worker.js`: MV3 service worker
  - `src/styles/`: design tokens and popup styles
  - `manifest.json`: MV3 manifest
- Code style: modern JS, minimal dependencies, accessibility in UI states, and responsive design.

## Roadmap

- Backoff strategies and rate‑limit awareness
- Toast notifications and richer progress HUD
- Light/Dark theme toggle
- Complete Engage automations
- Ad Blocker: heuristic tuning, per‑section toggles (Home/Trends/Profiles), and visual customization

## License

MIT
