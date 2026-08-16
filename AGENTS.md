# AGENTS.md — FomoDoro GNOME extension

GNOME Shell extension: Pomodoro timer + tasks + notes + analytics. This is a port of
the macOS app FomoDoro (repo: https://github.com/anasubaid19/fomo-doro) with full
feature parity. Keep features aligned with the macOS app.

## Repo layout

- `extension.js` — entry point: panel indicator + tabbed popup UI + completion handling + update check
- `popup.js` — the popover actor (header + Tasks/Notes/Stats/Settings tabs)
- `timer.js` — TimerEngine: pure state machine + persistence (no Shell deps)
- `stores.js` — DataStore: tasks/notes/history/stats via GSettings JSON
- `sounds.js` — SoundPlayer: paplay subprocess + Main.soundPlayer fallback
- `prefs.js` — minimal Adw preferences window (full settings live in the popup)
- `schemas/*.gschema.xml` — settings keys (JSON strings for tasks/notes/history/timer-state)
- `sounds/nokia_message.mp3`, `stylesheet.css`, `metadata.json`

## Feature spec (parity with macOS FomoDoro)

- **Timer**: focus/short/long break, long-break interval (4), cycle dots + "2 of 4"
  + tooltip, NEXT button = mark current phase done + advance + count (manual next has
  no sound/notification), auto-start next session, completion banner
  "Focus complete" with Start Break / Done, state persistence across shell restarts
  (phase/remaining/cycleCount), countdown in panel + toggle, presets
  (Classic 25/5, Deep Work 50/10, Sprint 15/3, Custom), daily goal.
- **Tasks**: list + pomodoro estimate + completed count (2/4), active task (click row),
  "+ Add Task" CTA → form (entry + estimate stepper), toggle done, delete,
  "Currently focusing" label on active row.
- **Notes**: multiline scratchpad autosaved on change + "Autosaved" caption.
- **Analytics**: Today (sessions/focus min/break min/tasks done), daily goal progress,
  streak, all-time (Xh Ym), last 7 days (total + avg/day + bar chart via Cairo),
  session history for today (time/task/duration).
- **Settings** (popup Settings tab): durations, presets, daily goal, sound choice
  (none/bundled/freedesktop/custom + preview), auto-start next, show countdown,
  auto-open popover on completion, single progress bar, update check + version.
- **Completion**: sound + notification (Main.notify/MessageTray) + banner + auto-open
  popup (setting-gated) + "🍅 ✓"-style cue in panel label.
- **Reduced motion**: respect `org.gnome.desktop.interface enable-animations`.

## Rules

- GJS + St/Clutter only. NO Swift.
- Core logic is tested by `gjs -m test-logic.js` (mock GSettings; macOS brew gjs needs `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib`). Keep it green.
- After editing `schemas/`, run: `glib-compile-schemas schemas/`
- Test on the GNOME machine: `gnome-extensions disable|enable pomodorotimer@anasubaid.dev`,
  restart shell (Alt+F2 → `r`), watch `journalctl -f -o cat /usr/bin/gnome-shell`.
- Install for dev: symlink repo → `~/.local/share/gnome-shell/extensions/pomodorotimer@anasubaid.dev`
- Git: small commits, tag `vX.Y.Z` per milestone, push. (macOS repo tags run v1.0.0–v1.6.0; this repo continues its own numbering from v1.0.0.)
- The macOS repo is the source of truth for behavior. Port, don't redesign.
