# FomoDoro (GNOME Shell Extension)

Pomodoro timer with **tasks, notes, and analytics** — a port of the macOS app
[FomoDoro](https://github.com/anasubaid19/fomo-doro). GNOME Shell 45+.

## Features

- Pomodoro timer (focus / short break / long break) with cycle dots and "N of 4"
- NEXT button marks the phase done and advances the cycle
- State persistence across shell restarts
- Tasks with pomodoro estimates, active task, done/delete
- Autosaved notes
- Analytics: today, daily goal, streak, all-time, last-7-days chart, session history
- Presets (Classic 25/5, Deep Work 50/10, Sprint 15/3, Custom), sound picker
- Popup auto-opens when a session completes (optional)
- Update check against GitHub releases

## Install

1. Download the `.zip` from Releases, or copy the extension folder to:
   `~/.local/share/gnome-shell/extensions/pomodorotimer@anasubaid.dev/`
2. Compile schemas:
   ```sh
   glib-compile-schemas schemas/
   ```
3. Restart the shell (`Alt+F2` → `r`) and enable:
   ```sh
   gnome-extensions enable pomodorotimer@anasubaid.dev
   ```
   (Or use **Extension Manager** / **GNOME Extensions** app.)

## Development

- After changing `schemas/`, run `glib-compile-schemas schemas/`.
- Test the core logic (no Shell needed):
  ```sh
  gjs -m test-logic.js        # macOS brew gjs: prefix DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib
  ```
- See `AGENTS.md` for architecture and parity rules.
