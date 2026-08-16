'use strict';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * Completion sound, played via paplay (PipeWire/PulseAudio) with
 * canberra-gtk-play as fallback.
 */
export class SoundPlayer {
    constructor(extensionDir) {
        this._extensionDir = extensionDir;
    }

    _resolveFile(choice) {
        if (choice === 'none')
            return null;
        if (choice === 'bundled')
            return this._extensionDir.get_child('sounds').get_child('nokia_message.mp3');
        if (choice.startsWith('freedesktop:')) {
            const name = choice.slice('freedesktop:'.length);
            return Gio.File.new_for_path(`/usr/share/sounds/freedesktop/stereo/${name}.oga`);
        }
        if (choice.startsWith('custom:'))
            return Gio.File.new_for_path(choice.slice('custom:'.length));
        return this._extensionDir.get_child('sounds').get_child('nokia_message.mp3');
    }

    play(choice) {
        const file = this._resolveFile(choice);
        if (file === null || !file.query_exists(null))
            return;
        const path = file.get_path();

        const paplay = GLib.find_program_in_path('paplay');
        if (paplay) {
            Gio.Subprocess.new(
                [paplay, path],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            return;
        }

        const canberra = GLib.find_program_in_path('canberra-gtk-play');
        if (canberra) {
            Gio.Subprocess.new(
                [canberra, '-f', path],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE
            );
        }
    }
}
