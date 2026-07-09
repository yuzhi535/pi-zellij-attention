# pi-zellij-attention

Pi + Zellij attention notifications for macOS/iTerm2.

This project is a Pi-focused Zellij workflow tool: when a Pi agent finishes inside a Zellij pane, the current tab gets a `✅` marker, macOS shows a desktop notification, and clicking that notification jumps back to the exact iTerm/Zellij pane that produced it.

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
</p>

## What it does

- **Pi completion notifications** — a Pi extension listens for `agent_end` and marks the originating Zellij pane as completed.
- **Clickable macOS notifications** — clicking the notification returns to the originating iTerm tab and Zellij pane.
- **Zellij tab markers** — the background WASM plugin appends icons such as `⏳` or `✅` to tab names.
- **Auto-clear on focus** — focusing the notified pane clears the tab marker.
- **Safe Zellij targeting** — notification clicks use the captured Zellij session name and pane id, so they work even when multiple Zellij sessions are open.
- **Display-only fallbacks** — if `terminal-notifier` is unavailable, the Pi extension can still show notifications through `alerter` or `osascript`, but click-to-pane requires `terminal-notifier`.

## Requirements

For the full Pi click-to-pane workflow:

- macOS
- iTerm2
- Zellij
- Pi coding agent
- [`terminal-notifier`](https://github.com/julienXX/terminal-notifier) for clickable desktop notifications
- The Zellij WASM plugin loaded via `load_plugins`

Optional fallbacks:

- `alerter`
- `osascript` (built into macOS)

These fallbacks can display a desktop notification, but they do not provide click-to-pane behavior.

## Architecture

There are two parts:

1. **Zellij WASM plugin**
   - Runs in the background through `load_plugins`.
   - Receives pipe messages like `zellij-attention::completed::<pane-id>`.
   - Appends notification icons to Zellij tab names.
   - Clears notification state when the pane is focused.

2. **Pi extension** (`pi-extension/index.ts`)
   - Listens for Pi `agent_end`.
   - Sends the completed pipe message for the current `ZELLIJ_PANE_ID`.
   - Sends a macOS desktop notification.
   - With `terminal-notifier`, embeds a click action that:
     1. selects the iTerm tab whose session name matches the captured Zellij session;
     2. runs `zellij --session <session> action focus-pane-id terminal_<pane>`.

## Installation

### Agent install prompt

Paste this prompt into Pi or another coding agent to install and verify the project for you:

````text
Install pi-zellij-attention on this macOS machine.

Repository: https://github.com/yuzhi535/pi-zellij-attention

Goal:
- Build and install the Zellij WASM plugin.
- Install the Pi extension.
- Ensure clickable macOS notifications work with iTerm2/Zellij.
- Verify with the provided tests and a manual `/zellij-attention-test` run.

Steps:
1. Clone or update the repository locally.
2. Run `npx --yes tsx --test pi-extension/index.test.ts`.
3. Run `cargo test --target "$(rustc -vV | awk '/host:/ {print $2}')" --lib`.
4. Run `cargo build --target wasm32-wasip1 --release`.
5. Copy `target/wasm32-wasip1/release/zellij-attention.wasm` to `~/.config/zellij/plugins/zellij-attention.wasm`.
6. Ensure `~/.config/zellij/config.kdl` has this `load_plugins` entry:

   ```kdl
   load_plugins {
       "file:~/.config/zellij/plugins/zellij-attention.wasm" {
           enabled "true"
           waiting_icon "⏳"
           completed_icon "✅"
       }
   }
   ```

7. Copy `pi-extension/index.ts` to `~/.pi/agent/extensions/zellij-attention/index.ts`.
8. Ensure `terminal-notifier` is installed; use `brew install terminal-notifier` if needed.
9. Ask me to restart Zellij if the `load_plugins` entry changed.
10. Ask me to run `/reload` in Pi, then `/zellij-attention-test`.
11. Confirm that clicking the macOS notification returns to the originating iTerm/Zellij pane.

Important constraints:
- Use `zellij pipe --name`, never `zellij pipe --plugin`.
- Do not expose or edit unrelated Pi configuration.
- Keep automatic Pi notification failures quiet; use `/zellij-attention-test` for visible setup errors.
````

### 1. Build and install the Zellij WASM plugin

Build from this repository:

```bash
cargo build --target wasm32-wasip1 --release
mkdir -p ~/.config/zellij/plugins
cp target/wasm32-wasip1/release/zellij-attention.wasm \
  ~/.config/zellij/plugins/zellij-attention.wasm
```

Add the plugin to `~/.config/zellij/config.kdl`:

```kdl
load_plugins {
    "file:~/.config/zellij/plugins/zellij-attention.wasm" {
        enabled "true"
        waiting_icon "⏳"
        completed_icon "✅"
    }
}
```

Restart Zellij after changing `load_plugins`.

### 2. Install the Pi extension

Copy the extension into Pi's global extension directory:

```bash
mkdir -p ~/.pi/agent/extensions/zellij-attention
cp pi-extension/index.ts ~/.pi/agent/extensions/zellij-attention/index.ts
```

Then restart Pi or run this inside Pi:

```text
/reload
```

### 3. Install clickable notification support

Install `terminal-notifier` if you want click-to-pane:

```bash
brew install terminal-notifier
```

## Quick start

Inside Pi, run:

```text
/zellij-attention-test
```

Expected behavior:

1. The current Zellij tab shows `✅`.
2. macOS shows a desktop notification.
3. Switch to another iTerm tab or Zellij session.
4. Click the notification.
5. iTerm switches back to the originating tab and Zellij focuses the originating pane.

Normal Pi turns also notify automatically when the agent turn ends.

## Pi behavior

- Pi sends `✅` on `agent_end`, after a Pi turn finishes.
- Automatic notification failures are quiet and never interrupt normal Pi usage.
- `/zellij-attention-test` reports setup errors through Pi UI notifications.
- The extension does not send waiting (`⏳`) notifications yet.
- Click-to-pane requires `terminal-notifier` and iTerm2. Other macOS notifiers are display-only fallbacks.

## Pipe protocol

The Zellij plugin still supports the original pipe protocol:

```text
zellij-attention::EVENT_TYPE::PANE_ID
```

- `EVENT_TYPE` — `waiting` or `completed` (case-insensitive)
- `PANE_ID` — numeric pane id from `$ZELLIJ_PANE_ID`

Always broadcast with `--name`:

```bash
zellij pipe --name "zellij-attention::waiting::$ZELLIJ_PANE_ID"
zellij pipe --name "zellij-attention::completed::$ZELLIJ_PANE_ID"
```

Do **not** use `zellij pipe --plugin`; targeted pipes can create a new plugin instance instead of reaching the existing background plugin.

## Shell integrations

The Zellij WASM plugin is tool-agnostic. Any process can send pipe messages.

```bash
notify-waiting() {
    [ -z "$ZELLIJ_PANE_ID" ] && echo "Not in Zellij" && return 1
    zellij pipe --name "zellij-attention::waiting::$ZELLIJ_PANE_ID"
}

notify-completed() {
    [ -z "$ZELLIJ_PANE_ID" ] && echo "Not in Zellij" && return 1
    zellij pipe --name "zellij-attention::completed::$ZELLIJ_PANE_ID"
}
```

## Configuration

All Zellij plugin configuration is optional.

| Option           | Default  | Description                     |
| ---------------- | -------- | ------------------------------- |
| `enabled`        | `"true"` | Enable or disable tab markers   |
| `waiting_icon`   | `"⏳"`   | Icon for waiting state          |
| `completed_icon` | `"✅"`   | Icon for completed state        |

Icons are appended to the end of tab names, for example `pi:code ✅`.

## Development

```bash
# TypeScript Pi extension tests
npx --yes tsx --test pi-extension/index.test.ts

# Native Rust unit tests
cargo test --target "$(rustc -vV | awk '/host:/ {print $2}')" --lib

# Build WASM plugin
cargo build --target wasm32-wasip1 --release

# Install local WASM build
cp target/wasm32-wasip1/release/zellij-attention.wasm ~/.config/zellij/plugins/

# Install local Pi extension
mkdir -p ~/.pi/agent/extensions/zellij-attention
cp pi-extension/index.ts ~/.pi/agent/extensions/zellij-attention/index.ts
```

Zellij caches compiled WASM. If plugin changes do not appear, clear the cache:

```bash
find ~/.cache/zellij -path "*zellij-attention*" -exec rm -f {} \;
```

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for Zellij plugin issues.

For Pi click-to-pane issues, check these first:

- `terminal-notifier` is installed and allowed to show notifications.
- Pi is running inside iTerm2 and Zellij.
- `ZELLIJ_SESSION_NAME` and `ZELLIJ_PANE_ID` exist in the Pi process environment.
- You ran `/reload` after copying `pi-extension/index.ts`.
- The Zellij WASM plugin was loaded through `load_plugins` after restarting Zellij.

## License

MIT
