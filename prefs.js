'use strict';

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Cairo from 'cairo';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const ByteArray = imports.byteArray;
const TextDecoder = globalThis.TextDecoder ?? ByteArray.TextDecoder;

const Gettext = imports.gettext;
const GETTEXT_DOMAIN = 'pomodorotimer@anasubaid.dev';
const _ = Gettext.domain(GETTEXT_DOMAIN).gettext;

const initTranslations = (extensionPath) => {
    if (typeof extensionPath !== 'string' || !extensionPath)
        return;
    const localeDir = GLib.build_filenamev([extensionPath, 'locale']);
    Gettext.bindtextdomain(GETTEXT_DOMAIN, localeDir);
    Gettext.textdomain(GETTEXT_DOMAIN);
};

const safeJsonParse = (value, fallback, context = 'JSON') => {
    if (typeof value !== 'string' || !value.trim())
        return fallback;
    try {
        const parsed = JSON.parse(value);
        return parsed ?? fallback;
    } catch (e) {
        logError(e, `[Fomo-Doro] Preferences failed to parse ${context}`);
        return fallback;
    }
};

const safeJsonStringify = (value, fallback, context = 'JSON') => {
    try {
        return JSON.stringify(value);
    } catch (e) {
        logError(e, `[Fomo-Doro] Preferences failed to serialize ${context}`);
        return fallback;
    }
};

const _analyticsDebugHistoryLenFromRaw = (raw) => {
    if (typeof raw !== 'string' || !raw.trim())
        return 0;
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
        return 0;
    }
};

const _analyticsDebugPreview = (raw, maxChars = 120) => {
    const s = typeof raw === 'string' ? raw : String(raw ?? '');
    return s.length > maxChars ? s.slice(0, maxChars) : s;
};

const _dateTimeToIso8601 = (dateTime) => {
    if (!dateTime)
        return null;
    if (typeof dateTime.format_iso8601 === 'function')
        return dateTime.format_iso8601();
    if (typeof dateTime.to_iso8601 === 'function')
        return dateTime.to_iso8601();
    if (typeof dateTime.format === 'function')
        return dateTime.format('%Y-%m-%dT%H:%M:%SZ');
    return null;
};

export default class FomoDoroTimerPreferences extends ExtensionPreferences {
    constructor(metadata) {
        super(metadata);
    }

    fillPreferencesWindow(window) {
        initTranslations(this.path);
        // Access the extension settings
        let settings = null;
        try {
            settings = this.getSettings('org.gnome.shell.extensions.pomodorotimer');
        } catch (e) {
            logError(e, '[Fomo-Doro] Preferences failed to load GSettings schema.');
            const page = new Adw.PreferencesPage({
                title: _('Setup Required'),
                icon_name: 'preferences-system-time-symbolic',
            });
            const group = new Adw.PreferencesGroup({
                title: _('GSettings schema missing'),
            });
            page.add(group);
            group.add(new Adw.ActionRow({
                title: _('Compile schemas'),
                subtitle: _('Run: glib-compile-schemas schemas/ (from the extension directory)'),
            }));
            window.add(page);
            return;
        }

        const page = new Adw.PreferencesPage({
            title: _('Timer Settings'),
            icon_name: 'preferences-system-time-symbolic',
        });
        const group = new Adw.PreferencesGroup({
            title: _('Timer Settings'),
        });
        page.add(group);
        
        const focusDurationRow = new Adw.ActionRow({
            title: _('Focus Duration (minutes)'),
        });
        group.add(focusDurationRow);

        const focusDurationSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                value: settings.get_int('focus-duration'),
                lower: 1,
                upper: 120,
                step_increment: 1,
            }),
            valign: Gtk.Align.CENTER,
        });
        focusDurationRow.add_suffix(focusDurationSpin);
        focusDurationRow.activatable_widget = focusDurationSpin;
        settings.bind('focus-duration', focusDurationSpin.get_adjustment(), 'value', Gio.SettingsBindFlags.DEFAULT);

        const shortBreakRow = new Adw.ActionRow({
            title: _('Short Break Duration (minutes)'),
        });
        group.add(shortBreakRow);

        const shortBreakSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                value: settings.get_int('short-break-duration'),
                lower: 1,
                upper: 60,
                step_increment: 1,
            }),
            valign: Gtk.Align.CENTER,
        });
        shortBreakRow.add_suffix(shortBreakSpin);
        shortBreakRow.activatable_widget = shortBreakSpin;
        settings.bind('short-break-duration', shortBreakSpin.get_adjustment(), 'value', Gio.SettingsBindFlags.DEFAULT);

        const longBreakRow = new Adw.ActionRow({
            title: _('Long Break Duration (minutes)'),
        });
        group.add(longBreakRow);

        const longBreakSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                value: settings.get_int('long-break-duration'),
                lower: 1,
                upper: 120,
                step_increment: 1,
            }),
            valign: Gtk.Align.CENTER,
        });
        longBreakRow.add_suffix(longBreakSpin);
        longBreakRow.activatable_widget = longBreakSpin;
        settings.bind('long-break-duration', longBreakSpin.get_adjustment(), 'value', Gio.SettingsBindFlags.DEFAULT);

        const longBreakIntervalRow = new Adw.ActionRow({
            title: _('Long Break Interval (sessions)'),
        });
        group.add(longBreakIntervalRow);

        const longBreakIntervalSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                value: settings.get_int('long-break-interval'),
                lower: 1,
                upper: 10,
                step_increment: 1,
            }),
            valign: Gtk.Align.CENTER,
        });
        longBreakIntervalRow.add_suffix(longBreakIntervalSpin);
        longBreakIntervalRow.activatable_widget = longBreakIntervalSpin;
        settings.bind('long-break-interval', longBreakIntervalSpin.get_adjustment(), 'value', Gio.SettingsBindFlags.DEFAULT);

        const autostartRow = new Adw.ActionRow({
            title: _('Auto-start next session'),
            subtitle: _('Start the next focus/break automatically when the current one ends'),
        });
        const autostartSwitch = new Gtk.Switch({
            active: settings.get_boolean('autostart-next-session'),
            valign: Gtk.Align.CENTER,
        });
        settings.bind('autostart-next-session', autostartSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        autostartRow.add_suffix(autostartSwitch);
        autostartRow.activatable_widget = autostartSwitch;
        group.add(autostartRow);

        const singleProgressRow = new Adw.ActionRow({
            title: _('Single progress ring'),
            subtitle: _('Show combined focus+break progress for the current cycle'),
        });
        const singleProgressSwitch = new Gtk.Switch({
            active: settings.get_boolean('single-progress-bar'),
            valign: Gtk.Align.CENTER,
        });
        settings.bind('single-progress-bar', singleProgressSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        singleProgressRow.add_suffix(singleProgressSwitch);
        singleProgressRow.activatable_widget = singleProgressSwitch;
        group.add(singleProgressRow);

        const notificationGroup = new Adw.PreferencesGroup({
            title: _('Notifications'),
        });
        page.add(notificationGroup);

        const soundSwitchRow = new Adw.ActionRow({
            title: _('Play sound on finish'),
        });
        const soundSwitch = new Gtk.Switch({
            active: settings.get_boolean('sound-enabled'),
            valign: Gtk.Align.CENTER,
        });
        settings.bind('sound-enabled', soundSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        soundSwitchRow.add_suffix(soundSwitch);
        notificationGroup.add(soundSwitchRow);

        const soundFileRow = new Adw.ActionRow({
            title: _('Custom sound file'),
            subtitle: _('Leave empty to use the default chime'),
        });
        const soundFileBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
        });
        const soundEntry = new Gtk.Entry({
            hexpand: true,
            text: settings.get_string('sound-file'),
        });
        soundEntry.connect('changed', () => settings.set_string('sound-file', soundEntry.text));
        const browseBtn = new Gtk.Button({ label: _('Browse') });
        browseBtn.connect('clicked', () => this._openFileChooser(window, soundEntry));
        soundFileBox.append(soundEntry);
        soundFileBox.append(browseBtn);
        soundFileRow.add_suffix(soundFileBox);
        soundFileRow.activatable_widget = soundEntry;
        notificationGroup.add(soundFileRow);

        const analyticsPage = new Adw.PreferencesPage({
            title: _('Focus Session History'),
            icon_name: 'document-open-recent-symbolic',
        });
        window.add(analyticsPage);

        const analyticsGroup = new Adw.PreferencesGroup({
            title: _('Focus Session History'),
        });
        analyticsPage.add(analyticsGroup);

        const analyticsChart = new AnalyticsChart(this, settings);
        analyticsGroup.add(analyticsChart);

        window.add(page);
    }

    _openFileChooser(window, entry) {
        const dialog = new Gtk.FileChooserNative({
            title: _('Select sound file'),
            transient_for: window,
            modal: true,
            action: Gtk.FileChooserAction.OPEN,
            accept_label: _('Select'),
            cancel_label: _('Cancel'),
        });

        dialog.connect('response', (dlg, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                const file = dlg.get_file();
                if (file) {
                    entry.text = file.get_path() ?? '';
                }
            }
            dlg.destroy();
        });

        dialog.show();
    }
}

const ChartView = {
    DAILY: 0,
    WEEKLY: 1,
};

const SESSION_TYPE = {
    FOCUS: 0,
    SHORT_BREAK: 1,
    LONG_BREAK: 2,
};

const _coerceSessionType = (type) => {
    if (type === SESSION_TYPE.FOCUS || type === SESSION_TYPE.SHORT_BREAK || type === SESSION_TYPE.LONG_BREAK)
        return type;
    if (typeof type === 'string') {
        const normalized = type.trim().toLowerCase();
        if (normalized === 'focus' || normalized === 'pomodoro')
            return SESSION_TYPE.FOCUS;
        if (normalized === 'short-break' || normalized === 'short_break' || normalized === 'short break' || normalized === 'break')
            return SESSION_TYPE.SHORT_BREAK;
        if (normalized === 'long-break' || normalized === 'long_break' || normalized === 'long break')
            return SESSION_TYPE.LONG_BREAK;
    }
    return null;
};

const _toUtcIsoTimestamp = (timestamp) => {
    try {
        if (timestamp instanceof GLib.DateTime) {
            const utc = typeof timestamp.to_utc === 'function' ? timestamp.to_utc() : timestamp;
            return _dateTimeToIso8601(utc);
        }

        if (typeof timestamp === 'string' && timestamp.trim()) {
            const parsed = GLib.DateTime.new_from_iso8601(timestamp.trim(), GLib.TimeZone.new_local());
            if (!parsed)
                return null;
            const utc = typeof parsed.to_utc === 'function' ? parsed.to_utc() : parsed;
            return _dateTimeToIso8601(utc);
        }

        if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
            const ts = Math.trunc(timestamp);
            const seconds = ts > 1_000_000_000_000 ? Math.trunc(ts / 1000) : ts;
            const parsed = GLib.DateTime.new_from_unix_utc(seconds);
            return parsed ? _dateTimeToIso8601(parsed) : null;
        }

        return null;
    } catch (e) {
        logError(e, '[Fomo-Doro] Preferences failed to normalize timestamp');
        return null;
    }
};

const _coerceDurationSeconds = (entry) => {
    const direct = Number(entry?.durationSeconds);
    if (Number.isFinite(direct) && direct > 0)
        return Math.max(1, Math.trunc(direct));

    const duration = Number(entry?.duration);
    if (Number.isFinite(duration) && duration > 0) {
        const n = Math.trunc(duration);
        if (n >= 600)
            return Math.max(1, n);
        return Math.max(1, n * 60);
    }

    return null;
};

const _normalizeHistoryEntry = (entry) => {
    try {
        if (!entry || typeof entry !== 'object')
            return null;

        const type = _coerceSessionType(entry.type);
        if (type === null)
            return null;

        const timestamp =
            _toUtcIsoTimestamp(entry.timestamp) ??
            _toUtcIsoTimestamp(entry.date) ??
            _toUtcIsoTimestamp(entry.time);
        if (!timestamp) {
            log(`[Fomo-Doro] Skipping history entry with invalid timestamp: ${safeJsonStringify(entry, '{}', 'history entry')}`);
            return null;
        }

        const durationSeconds = _coerceDurationSeconds(entry);
        if (!durationSeconds)
            return null;

        const completed = entry.completed === false ? false : true;
        const duration = Math.max(1, Math.round(durationSeconds / 60));

        return { timestamp, type, durationSeconds, completed, duration };
    } catch (e) {
        logError(e, '[Fomo-Doro] Preferences failed to normalize history entry');
        return null;
    }
};

const normalizeHistory = (history) => {
    const out = [];
    let changed = false;

    for (const raw of history ?? []) {
        let normalized = null;
        try {
            normalized = _normalizeHistoryEntry(raw);
        } catch (e) {
            logError(e, '[Fomo-Doro] Preferences normalizeHistory crashed');
            normalized = null;
        }
        if (!normalized) {
            changed = true;
            continue;
        }

        out.push(normalized);
        if (raw?.timestamp !== normalized.timestamp ||
            raw?.type !== normalized.type ||
            raw?.durationSeconds !== normalized.durationSeconds ||
            raw?.completed !== normalized.completed ||
            raw?.duration !== normalized.duration) {
            changed = true;
        }
    }

    return { entries: out, changed };
};

const toLocalDateTime = (timestamp) => {
    if (typeof timestamp !== 'string' || !timestamp.trim())
        return null;
    try {
        const parsed = GLib.DateTime.new_from_iso8601(timestamp, null);
        return parsed ? parsed.to_timezone(GLib.TimeZone.new_local()) : null;
    } catch (e) {
        logError(e, '[Fomo-Doro] Preferences failed to parse history timestamp');
        return null;
    }
};

const startOfLocalDay = (dt) => GLib.DateTime.new_local(
    dt.get_year(),
    dt.get_month(),
    dt.get_day_of_month(),
    0, 0, 0
);

const entryDurationMinutes = (entry) => {
    if (!entry) return 0;
    if (entry.completed === false) return 0;
    const minutes = Number(entry.duration);
    if (Number.isFinite(minutes) && minutes > 0)
        return Math.trunc(minutes);
    const seconds = Number(entry.durationSeconds);
    if (Number.isFinite(seconds) && seconds > 0)
        return Math.max(1, Math.round(seconds / 60));
    return 0;
};

const formatDurationMinutes = (minutes) => {
    const total = Math.max(0, Math.trunc(Number(minutes) || 0));
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    if (hours <= 0)
        return _('%d min').format(mins);
    if (mins === 0)
        return _('%d h').format(hours);
    return _('%d h %d min').format(hours, mins);
};

const _analyticsDebugDumpAnalyticsKeys = (settings, context = '') => {
    const prefix = '[ANALYTICS-DEBUG]';
    try {
        const schemaId =
            settings?.settings_schema?.get_id?.() ??
            settings?.schema_id ??
            settings?.settings_schema?.id ??
            'org.gnome.shell.extensions.pomodorotimer';
        const path = settings?.path ?? settings?.get_property?.('path') ?? '(unknown)';
        log(`${prefix} prefs dumpAnalyticsKeys context="${context}" schemaId="${schemaId}" path="${path}" settings=${Boolean(settings)}`);
        for (const key of ['history-json', 'today-stats', 'last-active-date']) {
            let val = null;
            try {
                val = settings?.get_string?.(key) ?? null;
            } catch (e) {
                logError(e, `${prefix} prefs dumpAnalyticsKeys: get_string failed for "${key}"`);
            }
            log(`${prefix} prefs dumpAnalyticsKeys key="${key}" value="${val}"`);
        }
        for (const key of ['current-cycle-index', 'current-session-type']) {
            let val = null;
            try {
                val = settings?.get_int?.(key) ?? null;
            } catch (e) {
                logError(e, `${prefix} prefs dumpAnalyticsKeys: get_int failed for "${key}"`);
            }
            log(`${prefix} prefs dumpAnalyticsKeys key="${key}" value=${val}`);
        }
    } catch (e) {
        logError(e, '[ANALYTICS-DEBUG] prefs dumpAnalyticsKeys crashed');
    }
};

const AnalyticsChart = GObject.registerClass({
    GTypeName: 'FomoDoroAnalyticsChart'
}, class AnalyticsChart extends Gtk.Box {
    constructor(extension, settings) {
        super({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 15,
            margin_top: 20,
            margin_bottom: 20,
            margin_start: 10,
            margin_end: 10,
        });
        this._extension = extension;
        this._settings = settings;
        this._history = [];
        this._view = ChartView.WEEKLY;
        this._stats = { empty: true, focusMinutes: 0, breakMinutes: 0, focusCount: 0, breakCount: 0, data: [] };
        this._settingsChangedId = null;
        try {
            const schemaId =
                this._settings?.settings_schema?.get_id?.() ??
                this._settings?.schema_id ??
                this._settings?.settings_schema?.id ??
                'org.gnome.shell.extensions.pomodorotimer';
            const path = this._settings?.path ?? this._settings?.get_property?.('path') ?? '(unknown)';
            log(`[ANALYTICS-DEBUG] prefs AnalyticsChart loaded schemaId="${schemaId}" path="${path}"`);
            _analyticsDebugDumpAnalyticsKeys(this._settings, 'AnalyticsChart constructor');
        } catch (e) {
            logError(e, '[ANALYTICS-DEBUG] prefs AnalyticsChart constructor diagnostics crashed');
        }

        const buttonBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            halign: Gtk.Align.CENTER,
            spacing: 10,
        });

        const dailyBtn = new Gtk.Button({label: _('Day')});
        dailyBtn.connect('clicked', () => this._setView(ChartView.DAILY));
        const weeklyBtn = new Gtk.Button({label: _('Week')});
        weeklyBtn.connect('clicked', () => this._setView(ChartView.WEEKLY));
        
        buttonBox.append(dailyBtn);
        buttonBox.append(weeklyBtn);
        this.append(buttonBox);

        const summaryBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            halign: Gtk.Align.CENTER,
            spacing: 18,
        });
        this._focusSummaryLabel = new Gtk.Label({ label: ' ', xalign: 0 });
        this._breakSummaryLabel = new Gtk.Label({ label: ' ', xalign: 0 });
        summaryBox.append(this._focusSummaryLabel);
        summaryBox.append(this._breakSummaryLabel);
        this.append(summaryBox);

        this._drawingArea = new Gtk.DrawingArea({
            content_height: 250,
            hexpand: true,
        });
        this._drawingArea.set_draw_func(this._drawChart.bind(this));
        this.append(this._drawingArea);

        this._loadHistory();
        if (this._settings) {
            this._settingsChangedId = this._settings.connect('changed::history-json', () => this._loadHistory());
            this.connect('destroy', () => {
                if (this._settingsChangedId) {
                    this._settings.disconnect(this._settingsChangedId);
                    this._settingsChangedId = null;
                }
            });
        }
    }

    _setView(view) {
        this._view = view;
        this._refresh();
    }

    _loadHistory() {
        if (!this._settings) {
            this._history = [];
            this._refresh();
            return;
        }
        const raw = this._settings.get_string('history-json');
        log(`[ANALYTICS-DEBUG] prefs AnalyticsChart reads key="history-json" raw="${raw}"`);
        const parsed = safeJsonParse(raw, [], 'history-json');
        const array = Array.isArray(parsed) ? parsed : [];
        const { entries, changed } = normalizeHistory(array);

        if (changed) {
            const serialized = safeJsonStringify(entries, '[]', 'history-json');
            if (typeof raw !== 'string' || raw.trim() !== serialized) {
                log(`[ANALYTICS-DEBUG] prefs AnalyticsChart: about to write history-json oldLen=${array.length} newLen=${entries.length}`);
                this._settings.set_string('history-json', serialized);
            }
            try {
                const readback = this._settings.get_string('history-json');
                log(`[ANALYTICS-DEBUG] prefs AnalyticsChart: after set_string history-json readbackPreview="${_analyticsDebugPreview(readback)}" len=${_analyticsDebugHistoryLenFromRaw(readback)}`);
            } catch (e) {
                logError(e, '[ANALYTICS-DEBUG] prefs AnalyticsChart readback get_string("history-json") failed');
            }
        }

        this._history = entries;
        this._refresh();
    }

    _refresh() {
        this._stats = this._computeStatsForView();
        log(`[ANALYTICS-DEBUG] prefs AnalyticsChart aggregates view=${this._view} stats=${safeJsonStringify(this._stats, '{}', 'prefs chart stats')}`);
        const focusMinutes = Math.max(0, this._stats.focusMinutes);
        const breakMinutes = Math.max(0, this._stats.breakMinutes);
        const focusCount = Math.max(0, this._stats.focusCount);
        const breakCount = Math.max(0, this._stats.breakCount);
        this._focusSummaryLabel.label = _('Focus: %d • %s').format(focusCount, formatDurationMinutes(focusMinutes));
        this._breakSummaryLabel.label = _('Break: %d • %s').format(breakCount, formatDurationMinutes(breakMinutes));
        this._drawingArea.queue_draw();
    }

    _drawChart(area, cr, width, height) {
        // Clear canvas
        cr.setSourceRGBA(0, 0, 0, 0);
        cr.paint();

        const data = this._stats?.data ?? [];
        if (!data.length || this._stats?.empty) {
            cr.setSourceRGB(0.5, 0.5, 0.5);
            cr.selectFontFace("sans-serif", Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
            cr.moveTo(20, height / 2);
            cr.showText(_('No data available. Complete some focus sessions to see your history.'));
            return;
        }

        const maxVal = data.reduce((max, d) => Math.max(max, d.value), 1);
        const barWidth = width / (data.length * 2);
        const spacing = barWidth;

        cr.setSourceRGB(0.2, 0.6, 0.8);

        for (let i = 0; i < data.length; i++) {
            const barHeight = (data[i].value / maxVal) * (height - 30);
            const x = (i * (barWidth + spacing)) + spacing / 2;
            const y = height - barHeight - 20;

            cr.rectangle(x, y, barWidth, barHeight);
            cr.fill();

            // Draw label
            cr.moveTo(x + barWidth / 2 - 10, height - 5);
            cr.showText(data[i].label);
        }
    }

    _computeStatsForView() {
        const now = GLib.DateTime.new_now_local();
        if (!this._history.length)
            return { empty: true, focusMinutes: 0, breakMinutes: 0, focusCount: 0, breakCount: 0, data: [] };

        if (this._view === ChartView.DAILY) {
            const start = startOfLocalDay(now);
            const end = start.add_days(1);

            let focusCount = 0;
            let breakCount = 0;
            let focusMinutes = 0;
            let breakMinutes = 0;

            for (const entry of this._history) {
                if (entry?.completed === false)
                    continue;
                const ts = toLocalDateTime(entry.timestamp);
                if (!ts || ts.compare(start) < 0 || ts.compare(end) >= 0)
                    continue;
                const type = entry.type ?? SESSION_TYPE.FOCUS;
                const minutes = Math.max(0, entryDurationMinutes(entry));
                if (type === SESSION_TYPE.FOCUS) {
                    focusCount += 1;
                    focusMinutes += minutes;
                } else {
                    breakCount += 1;
                    breakMinutes += minutes;
                }
            }

            const empty = focusCount === 0 && breakCount === 0 && focusMinutes <= 0 && breakMinutes <= 0;
            return {
                empty,
                focusMinutes,
                breakMinutes,
                focusCount,
                breakCount,
                data: [{ label: start.format('%a'), value: focusMinutes }],
            };
        }

        const weekStart = startOfLocalDay(now.add_days(1 - now.get_day_of_week()));
        const weekEnd = weekStart.add_days(7);

        const focusByDay = Array(7).fill(0);
        const dayLabels = [];
        for (let i = 0; i < 7; i++)
            dayLabels.push(weekStart.add_days(i).format('%a'));

        let focusCount = 0;
        let breakCount = 0;
        let focusMinutes = 0;
        let breakMinutes = 0;

        for (const entry of this._history) {
            if (entry?.completed === false)
                continue;
            const ts = toLocalDateTime(entry.timestamp);
            if (!ts || ts.compare(weekStart) < 0 || ts.compare(weekEnd) >= 0)
                continue;
            const type = entry.type ?? SESSION_TYPE.FOCUS;
            const minutes = Math.max(0, entryDurationMinutes(entry));
            if (type === SESSION_TYPE.FOCUS) {
                focusCount += 1;
                focusMinutes += minutes;
                const idx = Math.max(0, Math.min(6, ts.get_day_of_week() - 1));
                focusByDay[idx] += minutes;
            } else {
                breakCount += 1;
                breakMinutes += minutes;
            }
        }

        const empty = focusCount === 0 && breakCount === 0 && focusMinutes <= 0 && breakMinutes <= 0;
        const data = [];
        for (let i = 0; i < 7; i++)
            data.push({ label: dayLabels[i], value: focusByDay[i] });

        return { empty, focusMinutes, breakMinutes, focusCount, breakCount, data };
    }
});
