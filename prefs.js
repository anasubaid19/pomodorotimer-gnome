'use strict';

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SCHEMA_ID = 'org.gnome.shell.extensions.pomodorotimer';

const SOUND_OPTIONS = [
    ['none', _('None')],
    ['bundled', _('Bundled')],
    ['freedesktop:complete', _('Complete')],
    ['freedesktop:bell', _('Bell')],
    ['freedesktop:message', _('Message')],
    ['custom:', _('Custom path (set in popup)')],
];

const PRESET_OPTIONS = [
    ['classic', _('Classic — 25/5')],
    ['deep-work', _('Deep Work — 50/10')],
    ['sprint', _('Sprint — 15/3')],
    ['custom', _('Custom')],
];

export default class FomoDoroTimerPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings(SCHEMA_ID);
        const page = new Adw.PreferencesPage();
        window.add(page);

        const presetGroup = new Adw.PreferencesGroup({title: _('Preset')});
        const presetRow = new Adw.ComboRow({
            title: _('Timer preset'),
            subtitle: _('Applies focus/short break durations'),
        });
        const presetModel = new Gtk.StringList();
        for (const [, label] of PRESET_OPTIONS)
            presetModel.append(label);
        presetRow.model = presetModel;
        presetRow.connect('notify::selected', () => {
            const p = PRESET_OPTIONS[presetRow.selected]?.[0];
            const presets = {
                classic: {focus: 25, short: 5},
                'deep-work': {focus: 50, short: 10},
                sprint: {focus: 15, short: 3},
            };
            if (presets[p]) {
                settings.set_int('focus-duration', presets[p].focus);
                settings.set_int('short-break-duration', presets[p].short);
                settings.set_int('long-break-duration', 15);
                settings.set_string('preset', p);
            }
        });
        presetGroup.add(presetRow);
        page.add(presetGroup);

        const durationGroup = new Adw.PreferencesGroup({title: _('Durations (minutes)')});
        const mkSpin = (title, key, min, max) => {
            const row = new Adw.SpinRow({
                title,
                adjustment: new Gtk.Adjustment({
                    lower: min, upper: max, step_increment: 1, value: settings.get_int(key),
                }),
            });
            row.connect('notify::value', () => {
                settings.set_int(key, Math.round(row.value));
                settings.set_string('preset', 'custom');
            });
            return row;
        };
        durationGroup.add(mkSpin(_('Focus'), 'focus-duration', 1, 120));
        durationGroup.add(mkSpin(_('Short break'), 'short-break-duration', 1, 60));
        durationGroup.add(mkSpin(_('Long break'), 'long-break-duration', 1, 120));
        durationGroup.add(mkSpin(_('Long break every (sessions)'), 'long-break-interval', 1, 10));
        durationGroup.add(mkSpin(_('Daily goal (sessions)'), 'daily-goal', 1, 24));
        page.add(durationGroup);

        const soundGroup = new Adw.PreferencesGroup({title: _('Sound')});
        const soundRow = new Adw.ComboRow({title: _('Completion sound')});
        const soundModel = new Gtk.StringList();
        for (const [, label] of SOUND_OPTIONS)
            soundModel.append(label);
        soundRow.model = soundModel;
        soundRow.connect('notify::selected', () => {
            const id = SOUND_OPTIONS[soundRow.selected]?.[0];
            if (id !== undefined)
                settings.set_string('sound-choice', id);
        });
        soundGroup.add(soundRow);
        page.add(soundGroup);

        const behaviorGroup = new Adw.PreferencesGroup({title: _('Behavior')});
        const mkSwitch = (title, key) => {
            const row = new Adw.SwitchRow({title});
            row.set_active(settings.get_boolean(key));
            row.connect('notify::active', () => settings.set_boolean(key, row.active));
            return row;
        };
        behaviorGroup.add(mkSwitch(_('Auto-start next session'), 'autostart-next-session'));
        behaviorGroup.add(mkSwitch(_('Show countdown in panel'), 'show-countdown'));
        behaviorGroup.add(mkSwitch(_('Auto-open popup when a session ends'), 'auto-open-on-completion'));
        behaviorGroup.add(mkSwitch(_('Combined cycle progress'), 'single-progress-bar'));
        page.add(behaviorGroup);

        // Keep the widget state in sync with the actual settings values.
        window._fomodoroSettings = settings;
        window._fomodoroSync = () => {
            const preset = settings.get_string('preset');
            const idx = PRESET_OPTIONS.findIndex(([id]) => id === preset);
            if (idx >= 0)
                presetRow.selected = idx;
            const choice = settings.get_string('sound-choice');
            const sidx = SOUND_OPTIONS.findIndex(([id]) => choice === id || (id === 'custom:' && choice.startsWith('custom:')));
            if (sidx >= 0)
                soundRow.selected = sidx;
        };
        window._fomodoroSync();
    }
}
