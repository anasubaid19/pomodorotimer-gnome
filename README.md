# FomoDoro (GNOME Shell Extension)

Pomodoro timer with **tasks, notes, and analytics** — a port of the macOS app
[FomoDoro](https://github.com/anasubaid19/fomo-doro).

## Features

- Pomodoro timer (focus / short break / long break) with cycle dots and "N of 4"
- NEXT button marks the phase done and advances the cycle
- State persistence across shell restarts
- Tasks with pomodoro estimates, active task, done/delete
- Autosaved notes
- Analytics: today, daily goal, streak, all-time, last-7-days chart, session history
- Presets (Classic 25/5, Deep Work 50/10, Sprint 15/3, Custom), sound picker
- Popup auto-opens when a session completes (optional)
- Update check against GitHub Releases

## Requirements

- GNOME Shell **46–50** (X11 or Wayland)
- `paplay` (PipeWire-Pulse / PulseAudio) or `canberra-gtk-play` for completion sounds

## Install

1. Download the latest `pomodorotimer@anasubaid.dev.shell-extension.zip` from
   [Releases](../../releases).
2. Install or replace the existing extension with the downloaded ZIP:
   ```sh
   gnome-extensions install --force pomodorotimer@anasubaid.dev.shell-extension.zip
   ```
3. Restart GNOME Shell. On Wayland, **log out completely and log back in**;
   locking and unlocking the session is not sufficient.
4. Enable the extension:
   ```sh
   gnome-extensions enable pomodorotimer@anasubaid.dev
   ```
5. Verify that GNOME Shell recognizes it:
   ```sh
   gnome-extensions info pomodorotimer@anasubaid.dev
   ```

The release ZIP already contains `schemas/gschemas.compiled`; do not extract it or
copy its files manually before installation.

## Build an installable ZIP from source

Compile the schema before creating the ZIP, then install that ZIP through the same
supported installation command:

```sh
git clone https://github.com/anasubaid19/pomodorotimer-gnome.git
cd pomodorotimer-gnome
glib-compile-schemas schemas/
zip -r pomodorotimer@anasubaid.dev.shell-extension.zip . \
  -x "./.git/*" "./.github/*" "./.gitignore" \
  -x "./test-logic.js" "*.po" "*/.DS_Store"
gnome-extensions install --force pomodorotimer@anasubaid.dev.shell-extension.zip
```

After installation, log out and back in on Wayland, then enable the extension as
shown above. Re-run `glib-compile-schemas schemas/` whenever the schema changes.

## Update

Check for updates in the popup's **Settings** tab (it reads GitHub Releases).
To install a new version:

```sh
gnome-extensions install --force pomodorotimer@anasubaid.dev.shell-extension.zip
```

On Wayland, log out completely and log back in after every update.

## Uninstall

```sh
gnome-extensions disable pomodorotimer@anasubaid.dev
gnome-extensions uninstall pomodorotimer@anasubaid.dev
```

## Development

- After changing `schemas/`, run `glib-compile-schemas schemas/`.
- Test the core logic (no Shell needed):
  ```sh
  gjs -m test-logic.js        # macOS brew gjs: prefix DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib
  ```
- See `AGENTS.md` for architecture and parity rules.
