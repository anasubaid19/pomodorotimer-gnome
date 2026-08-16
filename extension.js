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
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {DataStore, SESSION_TYPE} from './stores.js';
import {TimerEngine} from './timer.js';
import {SoundPlayer} from './sounds.js';
import {FomoDoroPopup} from './popup.js';

export default class FomoDoroTimerExtension extends Extension {
    enable() {
        this._settings = this.getSettings('org.gnome.shell.extensions.pomodorotimer');
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

        this._soundPlayer.setFallbackPlayer((file) => {
            try {
                const player = global.display?.get_sound_player?.() ?? Main.soundPlayer;
                if (player)
                    player.play_from_file(file, this.uuid, null);
            } catch (e) {
                logError(e, '[FomoDoro] Failed to play fallback sound');
            }
        });

        this._popup.setAbout(
            `${_('FomoDoro')} ${this.metadata.version}`,
            _('Checking for updates…'));
        this._onEngineChange();
        this._checkUpdates();
    }

    disable() {
        if (this._engine) {
            this._engine.destroy();
            this._engine = null;
        }
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._popup = null;
        this._panelLabel = null;
        this._store = null;
        this._soundPlayer = null;
        this._settings = null;
    }

    _onEngineChange() {
        if (this._panelLabel)
            this._panelLabel.set_text(this._engine.panelText());
        if (this._popup)
            this._popup.refresh();
    }

    _onCompleted(session, manual) {
        if (!manual) {
            this._soundPlayer.play(this._store.soundChoice);
            this._showNotification(session.kind);
        }
        if (this._store.autoOpenOnCompletion && this._indicator && !this._indicator.menu.isOpen)
            this._indicator.menu.open();
    }

    _showNotification(kind) {
        const message = kind === SESSION_TYPE.FOCUS
            ? _('Time for a break!')
            : _('Time to focus!');
        try {
            const source = new MessageTray.Source(_('FomoDoro'), 'preferences-system-time-symbolic');
            Main.messageTray.add(source);
            const notification = new MessageTray.Notification(source, _('FomoDoro'), message);
            notification.setTransient(true);
            source.showNotification(notification);
        } catch (e) {
            try {
                Main.notify(_('FomoDoro'), message);
            } catch (err) {
                logError(err, '[FomoDoro] Failed to show notification');
            }
        }
    }

    _checkUpdates() {
        const latestUrl = 'https://api.github.com/repos/anasubaid19/pomodorotimer-gnome/releases/latest';
        const session = new Soup.Session();
        const msg = Soup.Message.new('GET', latestUrl);
        msg.request_headers.append('Accept', 'application/vnd.github+json');
        msg.request_headers.append('User-Agent', 'fomodoro-gnome');

        session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
            try {
                const bytes = sess.send_and_read_finish(res);
                const body = new TextDecoder().decode(bytes.get_data());
                const release = JSON.parse(body);
                const tag = release.tag_name ?? '';
                const latestNum = parseInt(tag.replace(/[^0-9]/g, ''), 10) || 0;
                const currentNum = Number(this.metadata.version) || 0;
                const updateText = latestNum > currentNum
                    ? `${_('Update available:')} ${tag}`
                    : _('Up to date');
                if (this._popup)
                    this._popup.setAbout(`${_('FomoDoro')} ${this.metadata.version}`, updateText);
            } catch (e) {
                logError(e, '[FomoDoro] Failed to check for updates');
                if (this._popup)
                    this._popup.setAbout(`${_('FomoDoro')} ${this.metadata.version}`, '');
            }
        });
    }
}
