'use strict';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Soup from 'gi://Soup3';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {DataStore, SESSION_TYPE} from './stores.js';
import {TimerEngine} from './timer.js';
import {SoundPlayer} from './sounds.js';
import {FomoDoroPopup} from './popup.js';

const APP_VERSION = '1.0.0';
const LATEST_RELEASE_URL = 'https://api.github.com/repos/anasubaid19/pomodorotimer-gnome/releases/latest';

// 'v1.0.0' → 1000000, so tags can be compared numerically.
const parseVersion = tag => tag.replace(/^v/, '').split('.').reduce((n, part) => n * 1000 + Number(part), 0);

export default class FomoDoroTimerExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._store = new DataStore(this._settings);
        this._soundPlayer = new SoundPlayer(this.dir);
        this._engine = new TimerEngine(this._store, {
            onChange: () => this._onEngineChange(),
            onCompleted: (session, manual) => this._onCompleted(session, manual),
        });

        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);
        this._panelLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'fomodoro-panel-label',
        });
        this._indicator.add_child(this._panelLabel);
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._popup = new FomoDoroPopup(this._engine, this._store, this._soundPlayer);
        const menuItem = new PopupMenu.PopupBaseMenuItem({reactive: false});
        menuItem.add_child(this._popup);
        this._indicator.menu.addMenuItem(menuItem);

        this._popup.setAbout(`${_('FomoDoro')} ${APP_VERSION}`, _('Checking for updates…'));
        this._onEngineChange();
        this._checkUpdates();
    }

    disable() {
        this._engine.destroy();
        this._engine = null;
        this._indicator.destroy();
        this._indicator = null;
        this._popup = null;
        this._panelLabel = null;
        this._store = null;
        this._soundPlayer = null;
        this._settings = null;
    }

    _onEngineChange() {
        this._panelLabel.set_text(this._engine.panelText());
        this._popup.refresh();
    }

    _onCompleted(session, manual) {
        if (!manual) {
            this._soundPlayer.play(this._store.soundChoice);
            const message = session.kind === SESSION_TYPE.FOCUS
                ? _('Time for a break!')
                : _('Time to focus!');
            Main.notify(_('FomoDoro'), message);
        }
        if (this._store.autoOpenOnCompletion && !this._indicator.menu.isOpen)
            this._indicator.menu.open();
    }

    _checkUpdates() {
        const session = new Soup.Session();
        const msg = Soup.Message.new('GET', LATEST_RELEASE_URL);
        msg.request_headers.append('Accept', 'application/vnd.github+json');
        msg.request_headers.append('User-Agent', 'fomodoro-gnome');

        session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (sess, result) => {
            let updateText = '';
            try {
                const bytes = sess.send_and_read_finish(result);
                const release = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                updateText = parseVersion(release.tag_name) > parseVersion(APP_VERSION)
                    ? _('Update available: %s').format(release.tag_name)
                    : _('Up to date');
            } catch (e) {
                console.error(`[FomoDoro] update check failed: ${e.message}`);
            }
            this._popup.setAbout(`${_('FomoDoro')} ${APP_VERSION}`, updateText);
        });
    }
}
