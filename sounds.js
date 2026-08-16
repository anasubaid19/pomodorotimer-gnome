'use strict';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * Completion sound. Tries `paplay` first, then falls back to the shell sound
 * player (injected by the extension) and finally to `canberra-gtk-play`.
 */
export class SoundPlayer {
    constructor(extensionDir) {
        this._extensionDir = extensionDir;
        this._fallbackPlayer = null;
    }

    setFallbackPlayer(fn) {
        this._fallbackPlayer = fn;
    }

    _resolveFile(choice) {
        if (choice === 'none')
            return null;
        if (choice === 'bundled') {
            const f = this._extensionDir.get_child('sounds').get_child('nokia_message.mp3');
            return f.query_exists(null) ? f : null;
        }
        if (choice.startsWith('freedesktop:')) {
            const name = choice.slice('freedesktop:'.length);
            const f = Gio.File.new_for_path(`/usr/share/sounds/freedesktop/stereo/${name}.oga`);
            return f.query_exists(null) ? f : null;
        }
        if (choice.startsWith('custom:')) {
            const path = choice.slice('custom:'.length);
            const f = Gio.File.new_for_path(path);
            return f.query_exists(null) ? f : null;
        }
        const fallback = this._extensionDir.get_child('sounds').get_child('nokia_message.mp3');
        return fallback.query_exists(null) ? fallback : null;
    }

    play(choice) {
        const file = this._resolveFile(choice ?? 'bundled');
        if (!file)
            return;
        const path = file.get_path();

        const paplayPath = GLib.find_program_in_path('paplay');
        if (paplayPath) {
            try {
                Gio.Subprocess.new(
                    [paplayPath, path],
                    Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE
                );
                return;
            } catch (e) {
                logError(e, '[FomoDoro] Failed to spawn paplay');
            }
        }

        if (this._fallbackPlayer) {
            try {
                this._fallbackPlayer(file);
                return;
            } catch (e) {
                logError(e, '[FomoDoro] Fallback sound player failed');
            }
        }

        const canberraPath = GLib.find_program_in_path('canberra-gtk-play');
        if (canberraPath) {
            try {
                Gio.Subprocess.new(
                    [canberraPath, '-f', path],
                    Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE
                );
            } catch (e) {
                logError(e, '[FomoDoro] Failed to spawn canberra-gtk-play');
            }
        }
    }
}
