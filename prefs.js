'use strict';

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class FomoDoroTimerPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        window.add(page);

        const durationGroup = new Adw.PreferencesGroup({title: _('Durations (minutes)')});
        const mkSpin = (title, key, max) => {
            const row = new Adw.SpinRow({
                title,
                adjustment: new Gtk.Adjustment({lower: 1, upper: max, step_increment: 1}),
            });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            durationGroup.add(row);
        };
        mkSpin(_('Focus'), 'focus-duration', 120);
        mkSpin(_('Short break'), 'short-break-duration', 60);
        mkSpin(_('Long break'), 'long-break-duration', 120);
        mkSpin(_('Long break every (sessions)'), 'long-break-interval', 12);
        mkSpin(_('Daily goal (sessions)'), 'daily-goal', 24);
        page.add(durationGroup);

        const behaviorGroup = new Adw.PreferencesGroup({title: _('Behavior')});
        const mkSwitch = (title, key) => {
            const row = new Adw.SwitchRow({title});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            behaviorGroup.add(row);
        };
        mkSwitch(_('Auto-start next session'), 'autostart-next-session');
        mkSwitch(_('Show countdown in panel'), 'show-countdown');
        mkSwitch(_('Auto-open popup when a session ends'), 'auto-open-on-completion');
        mkSwitch(_('Combined cycle progress'), 'single-progress-bar');
        page.add(behaviorGroup);
    }
}
