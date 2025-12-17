'use strict';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Cairo from 'cairo';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

const ByteArray = imports.byteArray;
const TextDecoder = globalThis.TextDecoder ?? ByteArray.TextDecoder;
const TextEncoder = globalThis.TextEncoder ?? ByteArray.TextEncoder;

const Gettext = imports.gettext;
const GETTEXT_DOMAIN = 'pomodorotimer@anasubaid.dev';
const _ = Gettext.domain(GETTEXT_DOMAIN).gettext;

const EMPTY_TODAY_STATS = Object.freeze({
    focusCount: 0,
    breakCount: 0,
    focusMinutes: 0,
    breakMinutes: 0,
});

const safeJsonParse = (value, fallback, context = 'JSON') => {
    if (typeof value !== 'string' || !value.trim())
        return fallback;
    try {
        const parsed = JSON.parse(value);
        return parsed ?? fallback;
    } catch (e) {
        logError(e, `[Fomo-Doro] Failed to parse ${context}`);
        return fallback;
    }
};

const safeJsonStringify = (value, fallback, context = 'JSON') => {
    try {
        return JSON.stringify(value);
    } catch (e) {
        logError(e, `[Fomo-Doro] Failed to serialize ${context}`);
        return fallback;
    }
};

const toInt = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const toLocalDateTime = (timestamp) => {
    if (typeof timestamp !== 'string' || !timestamp.trim())
        return null;
    try {
        const parsed = GLib.DateTime.new_from_iso8601(timestamp, null);
        return parsed ? parsed.to_timezone(GLib.TimeZone.new_local()) : null;
    } catch (e) {
        logError(e, '[Fomo-Doro] Failed to parse history timestamp');
        return null;
    }
};

const startOfLocalDay = (dt) => GLib.DateTime.new_local(
    dt.get_year(),
    dt.get_month(),
    dt.get_day_of_month(),
    0, 0, 0
);

const SETTINGS_SCHEMA_ID = 'org.gnome.shell.extensions.pomodorotimer';

const SETTINGS_DEFAULTS = Object.freeze({
    'focus-duration': 25,
    'short-break-duration': 5,
    'long-break-duration': 15,
    'long-break-interval': 4,
    'sound-enabled': true,
    'sound-file': '',
    'autostart-next-session': false,
    'single-progress-bar': false,
    'last-active-date': '',
    'today-stats': JSON.stringify(EMPTY_TODAY_STATS),
    'history-json': '[]',
    'current-cycle-index': 0,
    'current-session-type': 0,
});

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

const _analyticsDebugDumpAnalyticsKeys = (settingsLike, context = '') => {
    const prefix = '[ANALYTICS-DEBUG]';
    try {
        const safe = settingsLike ?? null;
        const gio = safe?._settings ?? safe;
        const schemaId =
            gio?.settings_schema?.get_id?.() ??
            gio?.schema_id ??
            gio?.settings_schema?.id ??
            SETTINGS_SCHEMA_ID;
        const path = gio?.path ?? gio?.get_property?.('path') ?? '(unknown)';

        log(`${prefix} dumpAnalyticsKeys context="${context}" schemaId="${schemaId}" path="${path}" safeSettings=${Boolean(safe?._settings || safe?._schema)}`);

        const stringKeys = ['history-json', 'today-stats', 'last-active-date'];
        for (const key of stringKeys) {
            let safeVal = null;
            let gioVal = null;
            let hasKey = null;
            try {
                hasKey = typeof safe?._hasKey === 'function' ? safe._hasKey(key) : null;
            } catch (e) {
                logError(e, `${prefix} dumpAnalyticsKeys: _hasKey crashed for "${key}"`);
            }
            try {
                safeVal = typeof safe?.get_string === 'function' ? safe.get_string(key) : null;
            } catch (e) {
                logError(e, `${prefix} dumpAnalyticsKeys: Safe get_string crashed for "${key}"`);
            }
            try {
                gioVal = typeof gio?.get_string === 'function' ? gio.get_string(key) : null;
            } catch (e) {
                logError(e, `${prefix} dumpAnalyticsKeys: Gio get_string crashed for "${key}"`);
            }
            log(`${prefix} dumpAnalyticsKeys key="${key}" hasKey=${hasKey} safe="${safeVal}" gio="${gioVal}"`);
        }

        const intKeys = ['current-cycle-index', 'current-session-type'];
        for (const key of intKeys) {
            let safeVal = null;
            let gioVal = null;
            let hasKey = null;
            try {
                hasKey = typeof safe?._hasKey === 'function' ? safe._hasKey(key) : null;
            } catch (e) {
                logError(e, `${prefix} dumpAnalyticsKeys: _hasKey crashed for "${key}"`);
            }
            try {
                safeVal = typeof safe?.get_int === 'function' ? safe.get_int(key) : null;
            } catch (e) {
                logError(e, `${prefix} dumpAnalyticsKeys: Safe get_int crashed for "${key}"`);
            }
            try {
                gioVal = typeof gio?.get_int === 'function' ? gio.get_int(key) : null;
            } catch (e) {
                logError(e, `${prefix} dumpAnalyticsKeys: Gio get_int crashed for "${key}"`);
            }
            log(`${prefix} dumpAnalyticsKeys key="${key}" hasKey=${hasKey} safe=${safeVal} gio=${gioVal}`);
        }
    } catch (e) {
        logError(e, '[ANALYTICS-DEBUG] dumpAnalyticsKeys crashed');
    }
};

const _getDefaultForKey = (key, type) => {
    const value = SETTINGS_DEFAULTS[key];
    if (type === 'i')
        return Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0;
    if (type === 'b')
        return Boolean(value);
    if (type === 's')
        return typeof value === 'string' ? value : '';
    return value;
};

const _loadGioSettingsOrNull = (extension) => {
    try {
        return extension.getSettings();
    } catch (e) {
        logError(
            e,
            `[Fomo-Doro] Failed to load GSettings schema "${SETTINGS_SCHEMA_ID}". ` +
            `If you're developing locally, run: glib-compile-schemas schemas/`
        );
    }

    try {
        const schemasDir = extension.dir.get_child('schemas').get_path();
        const source = Gio.SettingsSchemaSource.new_from_directory(
            schemasDir,
            Gio.SettingsSchemaSource.get_default(),
            false
        );
        const schema = source.lookup(SETTINGS_SCHEMA_ID, true);
        if (!schema) {
            log(`[Fomo-Doro] GSettings schema "${SETTINGS_SCHEMA_ID}" not found in ${schemasDir}`);
            return null;
        }
        return new Gio.Settings({ settings_schema: schema });
    } catch (e) {
        logError(
            e,
            `[Fomo-Doro] Failed to load GSettings schema "${SETTINGS_SCHEMA_ID}" from extension schemas/.`
        );
        return null;
    }
};

class SafeSettings {
    constructor(settings) {
        this._settings = settings ?? null;
        this._schema = this._settings?.settings_schema ?? null;
    }

    _hasKey(key) {
        try {
            if (this._schema?.has_key)
                return this._schema.has_key(key);
        } catch (e) {
            logError(e, `[Fomo-Doro] Failed to validate GSettings key "${key}"`);
        }
        return false;
    }

    _fallbackGet(key, type) {
        return _getDefaultForKey(key, type);
    }

    get_int(key) {
        if (!this._settings || !this._hasKey(key))
            return this._fallbackGet(key, 'i');
        try {
            const value = this._settings.get_int(key);
            return Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : this._fallbackGet(key, 'i');
        } catch (e) {
            logError(e, `[Fomo-Doro] GSettings get_int failed for "${key}"`);
            return this._fallbackGet(key, 'i');
        }
    }

    get_boolean(key) {
        if (!this._settings || !this._hasKey(key))
            return this._fallbackGet(key, 'b');
        try {
            return Boolean(this._settings.get_boolean(key));
        } catch (e) {
            logError(e, `[Fomo-Doro] GSettings get_boolean failed for "${key}"`);
            return this._fallbackGet(key, 'b');
        }
    }

    get_string(key) {
        if (!this._settings || !this._hasKey(key))
            return this._fallbackGet(key, 's');
        try {
            const value = this._settings.get_string(key);
            if (typeof value === 'string' && value.trim() === '' && this._fallbackGet(key, 's').trim() !== '')
                return this._fallbackGet(key, 's');
            return typeof value === 'string' ? value : this._fallbackGet(key, 's');
        } catch (e) {
            logError(e, `[Fomo-Doro] GSettings get_string failed for "${key}"`);
            return this._fallbackGet(key, 's');
        }
    }

    set_int(key, value) {
        if (!this._settings || !this._hasKey(key))
            return false;
        try {
            return this._settings.set_int(key, Math.trunc(Number(value)));
        } catch (e) {
            logError(e, `[Fomo-Doro] GSettings set_int failed for "${key}"`);
            return false;
        }
    }

    set_boolean(key, value) {
        if (!this._settings || !this._hasKey(key))
            return false;
        try {
            return this._settings.set_boolean(key, Boolean(value));
        } catch (e) {
            logError(e, `[Fomo-Doro] GSettings set_boolean failed for "${key}"`);
            return false;
        }
    }

    set_string(key, value) {
        if (!this._settings || !this._hasKey(key))
            return false;
        try {
            return this._settings.set_string(key, String(value ?? ''));
        } catch (e) {
            logError(e, `[Fomo-Doro] GSettings set_string failed for "${key}"`);
            return false;
        }
    }
}



const TIMER_STATE = {
    STOPPED: 0,
    RUNNING: 1,
    PAUSED: 2,
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

const _nowUtcIso8601 = () => {
    try {
        return _dateTimeToIso8601(GLib.DateTime.new_now_utc());
    } catch (e) {
        logError(e, '[Fomo-Doro] Failed to create UTC ISO timestamp');
        return null;
    }
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
        logError(e, '[Fomo-Doro] Failed to normalize timestamp');
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
        // Heuristic: legacy data may store seconds in `duration` (e.g. 1500) or minutes (e.g. 25).
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
        logError(e, '[Fomo-Doro] Failed to normalize history entry');
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
            logError(e, '[Fomo-Doro] normalizeHistory crashed');
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

const TICK_INTERVAL_MS = 250;

const getSessionLabel = (type) => {
    switch (type) {
        case SESSION_TYPE.FOCUS:
            return _('Focus');
        case SESSION_TYPE.SHORT_BREAK:
            return _('Short break');
        case SESSION_TYPE.LONG_BREAK:
            return _('Long break');
        default:
            return '';
    }
};

const StatsView = {
    DAY: 0,
    WEEK: 1,
};

const formatDurationMinutes = (minutes) => {
    const total = Math.max(0, Math.round(toInt(minutes, 0)));
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    if (hours <= 0)
        return _('%d min').format(mins);
    if (mins === 0)
        return _('%d h').format(hours);
    return _('%d h %d min').format(hours, mins);
};

const formatCompactDurationMinutes = (minutes) => {
    const total = Math.max(0, Math.round(toInt(minutes, 0)));
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    if (hours <= 0)
        return _('%dm').format(mins);
    if (mins === 0)
        return _('%dh').format(hours);
    return _('%dh %dm').format(hours, mins);
};

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

const computeRangeStats = (entries, start, end) => {
    let focusCount = 0;
    let breakCount = 0;
    let focusMinutes = 0;
    let breakMinutes = 0;

    for (const entry of entries ?? []) {
        if (entry?.completed === false)
            continue;
        const ts = toLocalDateTime(entry?.timestamp);
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
    return { empty, focusMinutes, breakMinutes, focusCount, breakCount };
};

const StatsDialog = GObject.registerClass(
class StatsDialog extends ModalDialog.ModalDialog {
    _init(indicator) {
        super._init({ styleClass: 'fomo-doro-stats-dialog' });
        this._indicator = indicator;
        log('[ANALYTICS-DEBUG] StatsDialog opened');
        try {
            const safe = this._indicator?._settings ?? null;
            const gio = safe?._settings ?? null;
            const schemaId =
                gio?.settings_schema?.get_id?.() ??
                gio?.schema_id ??
                gio?.settings_schema?.id ??
                SETTINGS_SCHEMA_ID;
            const path = gio?.path ?? gio?.get_property?.('path') ?? '(unknown)';
            let safeHistory = null;
            let rawHistory = null;
            try { safeHistory = safe?.get_string?.('history-json') ?? null; } catch (e) { logError(e, '[ANALYTICS-DEBUG] StatsDialog: Safe get_string("history-json") failed'); }
            try { rawHistory = gio?.get_string?.('history-json') ?? null; } catch (e) { logError(e, '[ANALYTICS-DEBUG] StatsDialog: Gio get_string("history-json") failed'); }
            log(`[ANALYTICS-DEBUG] StatsDialog reads schemaId="${schemaId}" path="${path}" key="history-json" safe="${safeHistory}" gio="${rawHistory}"`);
            _analyticsDebugDumpAnalyticsKeys(safe, 'StatsDialog opened');
        } catch (e) {
            logError(e, '[ANALYTICS-DEBUG] StatsDialog open diagnostics crashed');
        }
        this._history = [];
        this._view = StatsView.DAY;
        this._historySignalId = this._indicator?.connect?.('history-updated', () => {
            this._onHistoryUpdated();
        }) ?? null;

        const mainContent = new St.BoxLayout({
            vertical: true,
            style_class: 'fomo-doro-stats-container',
        });

        this.contentLayout.add_child(mainContent);

        const header = new St.BoxLayout({ x_align: Clutter.ActorAlign.FILL, style_class: 'fomo-doro-stats-header' });
        const viewToggle = new St.BoxLayout({ style_class: 'fomo-doro-stats-view-toggle', x_expand: true });
        this._dayBtn = this._makeViewButton(_('Day'), StatsView.DAY);
        this._weekBtn = this._makeViewButton(_('Week'), StatsView.WEEK);
        viewToggle.add_child(this._dayBtn);
        viewToggle.add_child(this._weekBtn);
        const prefsBtn = new St.Button({
            child: new St.Icon({ icon_name: 'preferences-system-symbolic', style_class: 'fomo-doro-stats-icon' }),
            style_class: 'button fomo-doro-stats-icon-button',
            accessible_name: _('Settings'),
            can_focus: true,
            x_expand: false,
        });
        prefsBtn.connect('clicked', () => this._indicator._extension.openPreferences());
        header.add_child(viewToggle);
        header.add_child(prefsBtn);
        mainContent.add_child(header);

        this._summaryCard = new St.BoxLayout({
            vertical: true,
            style_class: 'fomo-doro-stats-card fomo-doro-stats-summary-card',
        });
        this._focusTotalLabel = new St.Label({
            text: '—',
            style_class: 'fomo-doro-stats-focus-time',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._summaryCard.add_child(this._focusTotalLabel);
        this._sessionCountsLabel = new St.Label({
            text: '',
            style_class: 'fomo-doro-stats-summary-subtitle',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._summaryCard.add_child(this._sessionCountsLabel);
        mainContent.add_child(this._summaryCard);

        this._chartCard = new St.BoxLayout({
            vertical: true,
            style_class: 'fomo-doro-stats-card fomo-doro-stats-chart-card',
        });
        this._chartBox = new St.BoxLayout({
            vertical: true,
            style_class: 'fomo-doro-stats-chart-box',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        this._chartCard.add_child(this._chartBox);
        mainContent.add_child(this._chartCard);

        this._updatedLabel = new St.Label({
            text: '',
            style_class: 'fomo-doro-stats-footer',
            x_align: Clutter.ActorAlign.CENTER,
        });
        mainContent.add_child(this._updatedLabel);

        this.setButtons([
            {
                label: _('Close'),
                action: () => this.close(),
            },
        ]);

        this._loadHistory();
        this._setView(this._view);
    }

    _makeViewButton(label, view) {
        const btn = new St.Button({
            label,
            style_class: 'button fomo-doro-stats-view-button',
            toggle_mode: true,
            can_focus: true,
            x_expand: true,
        });
        btn.connect('clicked', () => this._setView(view));
        return btn;
    }

    _setView(view) {
        this._view = view;
        const setBtn = (btn, val) => {
            if (btn?.set_checked) btn.set_checked(val);
            else if (btn) btn.checked = val;
        };
        setBtn(this._dayBtn, view === StatsView.DAY);
        setBtn(this._weekBtn, view === StatsView.WEEK);
        this._render();
    }

    _loadHistory() {
        this._history = this._indicator._loadHistory();
        this._render();
    }

    _onHistoryUpdated() {
        this._history = this._indicator._loadHistory();
        this._render();
    }

    _computeDayStats() {
        const now = GLib.DateTime.new_now_local();
        const start = startOfLocalDay(now);
        const end = start.add_days(1);
        return computeRangeStats(this._history, start, end);
    }

    _computeWeekStats() {
        const now = GLib.DateTime.new_now_local();
        const weekStart = startOfLocalDay(now.add_days(1 - now.get_day_of_week()));
        const weekEnd = weekStart.add_days(7);

        const dailyFocusMinutes = Array(7).fill(0);
        const dayLabels = [];
        for (let i = 0; i < 7; i++)
            dayLabels.push(weekStart.add_days(i).format('%a'));

        let focusCount = 0;
        let breakCount = 0;
        let breakMinutes = 0;
        for (const entry of this._history) {
            if (entry?.completed === false)
                continue;
            const ts = this._toLocalDate(entry.timestamp);
            if (!ts || ts.compare(weekStart) < 0 || ts.compare(weekEnd) >= 0)
                continue;

            const type = entry.type ?? SESSION_TYPE.FOCUS;
            const minutes = Math.max(0, entryDurationMinutes(entry));
            if (type === SESSION_TYPE.FOCUS) {
                focusCount += 1;
                const idx = Math.max(0, Math.min(6, ts.get_day_of_week() - 1));
                dailyFocusMinutes[idx] += minutes;
            } else {
                breakCount += 1;
                breakMinutes += minutes;
            }
        }

        const focusMinutes = dailyFocusMinutes.reduce((acc, v) => acc + v, 0);
        const empty = focusCount === 0 && breakCount === 0 && focusMinutes <= 0;
        return { empty, focusMinutes, breakMinutes, focusCount, breakCount, dailyFocusMinutes, dayLabels };
    }

    _computeStatsForView() {
        return this._view === StatsView.WEEK
            ? this._computeWeekStats()
            : this._computeDayStats();
    }

    _clearChart() {
        for (const child of this._chartBox.get_children())
            child.destroy();
    }

    _buildEmptyState() {
        const box = new St.BoxLayout({ vertical: true, style_class: 'fomo-doro-stats-empty', x_expand: true });
        const title = this._view === StatsView.WEEK
            ? _('No focus sessions this week')
            : _('No sessions today');
        box.add_child(new St.Label({
            text: title,
            style_class: 'fomo-doro-stats-empty-title',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        box.add_child(new St.Label({
            text: _('Start a focus session to see statistics.'),
            style_class: 'fomo-doro-stats-empty-subtitle',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        this._chartBox.add_child(box);
    }

    _buildBarRow({ label, minutes, maxMinutes, kind }) {
        const row = new St.BoxLayout({ style_class: 'fomo-doro-stats-bar-row', x_expand: true, x_align: Clutter.ActorAlign.START });
        row.add_child(new St.Label({
            text: label,
            style_class: 'fomo-doro-stats-bar-label',
            x_align: Clutter.ActorAlign.START,
        }));

        const track = new St.BoxLayout({
            style_class: 'fomo-doro-stats-bar-track',
            x_expand: true,
            clip_to_allocation: true,
        });
        const fill = new St.Widget({ style_class: `fomo-doro-stats-bar-fill fomo-doro-stats-bar-fill-${kind}` });
        const spacer = new St.Widget({ x_expand: true });
        track.add_child(fill);
        track.add_child(spacer);

        const value = new St.Label({
            text: formatCompactDurationMinutes(minutes),
            style_class: 'fomo-doro-stats-bar-value',
            x_align: Clutter.ActorAlign.END,
        });

	        const updateWidths = () => {
	            const width = Math.max(0, track.get_width());
	            if (width <= 0)
	                return;
	            const frac = maxMinutes > 0 ? Math.max(0, Math.min(1, minutes / maxMinutes)) : 0;
	            let fillW = Math.round(width * frac);
	            if (minutes > 0 && fillW < 6)
	                fillW = 6;
	            fill.set_width(Math.max(0, fillW));
	            const filledOpacity = kind === 'break' ? 140 : 255;
	            const emptyOpacity = kind === 'break' ? 70 : 90;
	            fill.opacity = minutes > 0 ? filledOpacity : emptyOpacity;
	        };
	        updateWidths();

        row.add_child(track);
        row.add_child(value);
        this._chartBox.add_child(row);
    }

    _buildDayBars(stats) {
        const focusMinutes = Math.max(0, stats.focusMinutes);
        const breakMinutes = Math.max(0, stats.breakMinutes);
        const maxVal = Math.max(focusMinutes, breakMinutes, 0);
        if (maxVal <= 0) {
            this._buildEmptyState();
            return;
        }

        this._buildBarRow({ label: _('Focus'), minutes: focusMinutes, maxMinutes: maxVal, kind: 'focus' });
        this._buildBarRow({ label: _('Break'), minutes: breakMinutes, maxMinutes: maxVal, kind: 'break' });
    }

    _buildWeekBars(stats) {
        const minutes = stats.dailyFocusMinutes ?? [];
        const labels = stats.dayLabels ?? [];
        const maxVal = Math.max(...minutes, 0);
        if (maxVal <= 0) {
            this._buildEmptyState();
            return;
        }

        for (let i = 0; i < 7; i++) {
            this._buildBarRow({
                label: labels[i] ?? '',
                minutes: Math.max(0, minutes[i] ?? 0),
                maxMinutes: maxVal,
                kind: 'focus',
            });
        }
    }

    _render() {
        const stats = this._computeStatsForView();
        try {
            const day = this._computeDayStats();
            const week = this._computeWeekStats();
            log(`[ANALYTICS-DEBUG] StatsDialog aggregates view=${this._view} day=${safeJsonStringify(day, '{}', 'StatsDialog day stats')} week=${safeJsonStringify(week, '{}', 'StatsDialog week stats')}`);
        } catch (e) {
            logError(e, '[ANALYTICS-DEBUG] StatsDialog aggregates computation failed');
        }
        const focusMinutes = Math.max(0, stats.focusMinutes);
        const focusCount = Math.max(0, stats.focusCount);
        const breakCount = Math.max(0, stats.breakCount);
        const breakMinutes = Math.max(0, stats.breakMinutes);

        this._focusTotalLabel.text = formatDurationMinutes(focusMinutes);
        this._sessionCountsLabel.text = `${focusCount} ${_('Focus')} • ${breakCount} ${_('Break')}`;

        this._clearChart();
        if (stats.empty) {
            this._buildEmptyState();
        } else if (this._view === StatsView.WEEK) {
            this._buildWeekBars(stats);
        } else {
            this._buildDayBars(stats);
        }

        const now = GLib.DateTime.new_now_local();
        this._updatedLabel.text = _('Updated %s').format(now.format('%H:%M'));
    }

    _toLocalDate(timestamp) {
        return toLocalDateTime(timestamp);
    }

    destroy() {
        if (this._historySignalId) {
            this._indicator?.disconnect?.(this._historySignalId);
            this._historySignalId = null;
        }
        super.destroy();
    }
});

const FomoDoroTimerIndicator = GObject.registerClass({
    Signals: {
        'history-updated': {},
    },
}, class FomoDoroTimerIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, _('Fomo-Doro Timer'));
        this._extension = extension;
        this._settings = new SafeSettings(_loadGioSettingsOrNull(this._extension));

        this._timerState = TIMER_STATE.STOPPED;
        this._sessionType = SESSION_TYPE.FOCUS;
        this._sessionCount = 0;
        this._openStatsDialogIdleId = null;
        this._dailyCheckId = null;
        this._sessionEndTimestampMs = null;
        this._finishHandled = false;
        this._lastTickLoggedRemainingSec = null;

        this._migrateLegacyHistoryIfNeeded();
        this._ensureDailyState({ applyRuntimeReset: false });
        this._restoreCycleStateFromSettings();
        this._hydrateTodayStatsFromHistoryIfNeeded();
        this._cycleTotalSeconds = this._computeCycleTotalSeconds();
        this._startDailyCheck();

        this._panelIcon = new St.Icon({
            icon_name: 'preferences-system-time-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._panelIcon);
        this.connect('button-press-event', this._onButtonPress.bind(this));

        this._buildMenu();

        this._updateTime();
    }

    _startDailyCheck() {
        if (this._dailyCheckId)
            return;
        this._dailyCheckId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this._ensureDailyState({ applyRuntimeReset: true, allowDuringRun: false });
            return GLib.SOURCE_CONTINUE;
        });
    }

    _getTodayDateString() {
        return GLib.DateTime.new_now_local().format('%Y-%m-%d');
    }

    _ensureDailyState({ applyRuntimeReset = true, allowDuringRun = false, preserveSessionType = false } = {}) {
        const today = this._getTodayDateString();
        const last = this._settings.get_string('last-active-date');

        if (last && last === today)
            return false;

        const historyBefore = this._settings.get_string('history-json');
        log(`[ANALYTICS-DEBUG] ensureDailyState: reset running today="${today}" last="${last}" historyLenBefore=${_analyticsDebugHistoryLenFromRaw(historyBefore)}`);

        const resetType = preserveSessionType ? this._sessionType : SESSION_TYPE.FOCUS;
        const nextType = [SESSION_TYPE.FOCUS, SESSION_TYPE.SHORT_BREAK, SESSION_TYPE.LONG_BREAK].includes(resetType)
            ? resetType
            : SESSION_TYPE.FOCUS;

        this._settings.set_string('last-active-date', today);
        {
            const safe = this._settings;
            const gio = safe?._settings;
            const schemaId =
                gio?.settings_schema?.get_id?.() ??
                gio?.schema_id ??
                gio?.settings_schema?.id ??
                SETTINGS_SCHEMA_ID;
            const path = gio?.path ?? gio?.get_property?.('path') ?? '(unknown)';
            let raw = null;
            try {
                raw = gio?.get_string?.('last-active-date') ?? null;
            } catch (e) {
                logError(e, '[ANALYTICS-DEBUG] ensureDailyState: Gio get_string("last-active-date") failed');
            }
            log(`[ANALYTICS-DEBUG] ensureDailyState wrote schemaId="${schemaId}" path="${path}" key="last-active-date" readbackSafe="${safe.get_string('last-active-date')}" readbackGio="${raw}"`);
        }
        {
            const history = this._loadHistory();
            const now = GLib.DateTime.new_now_local();
            const start = startOfLocalDay(now);
            const end = start.add_days(1);
            this._setTodayStats(computeRangeStats(history, start, end));
        }
        this._settings.set_int('current-cycle-index', 0);
        this._settings.set_int('current-session-type', nextType);

        const canResetRuntime = applyRuntimeReset && (allowDuringRun || this._timerState !== TIMER_STATE.RUNNING);
        if (canResetRuntime) {
            this._clearTimerSource();
            this._sessionEndTimestampMs = null;
            this._timerState = TIMER_STATE.STOPPED;
            this._sessionCount = 0;
            if (!preserveSessionType)
                this._sessionType = SESSION_TYPE.FOCUS;
            this._cycleTotalSeconds = this._computeCycleTotalSeconds();
            if (this._timeLabel)
                this._updateTime();
        }

        this.emit('history-updated');
        const historyAfter = this._settings.get_string('history-json');
        const modifiedHistory = historyBefore.trim() !== historyAfter.trim();
        log(`[ANALYTICS-DEBUG] ensureDailyState: reset done modifiedHistoryJson=${modifiedHistory} historyLenAfter=${_analyticsDebugHistoryLenFromRaw(historyAfter)}`);
        return true;
    }

    onSessionFinished(sessionType, durationSeconds = null) {
        const timestampUtc = _nowUtcIso8601();
        log(`[ANALYTICS-DEBUG] onSessionFinished reached timestampUtc="${timestampUtc}" sessionType=${sessionType}("${getSessionLabel(sessionType)}") durationSecondsArg=${durationSeconds}`);
        const configured = this._getTotalSecondsForType(sessionType);
        let seconds = Number(durationSeconds);
        seconds = Number.isFinite(seconds) ? Math.trunc(seconds) : 0;
        if (seconds <= 0)
            seconds = Math.max(1, configured);

        const didDailyReset = this._ensureDailyState({ applyRuntimeReset: true, allowDuringRun: true, preserveSessionType: true });
        log(`[ANALYTICS-DEBUG] onSessionFinished normalizedSeconds=${seconds} configuredSeconds=${configured} ensureDailyStateChanged=${didDailyReset}`);
        log('[ANALYTICS-DEBUG] onSessionFinished calling _saveSession');
        this._saveSession(sessionType, seconds);
        log('[ANALYTICS-DEBUG] onSessionFinished finished _saveSession');
    }

    _getTodayStats() {
        const history = this._loadHistory();
        const now = GLib.DateTime.new_now_local();
        const start = startOfLocalDay(now);
        const end = start.add_days(1);
        const stats = computeRangeStats(history, start, end);
        this._setTodayStats(stats);
        return stats;
    }

    _setTodayStats(stats) {
        const safe = {
            focusCount: Math.max(0, toInt(stats.focusCount, 0)),
            breakCount: Math.max(0, toInt(stats.breakCount, 0)),
            focusMinutes: Math.max(0, toInt(stats.focusMinutes, 0)),
            breakMinutes: Math.max(0, toInt(stats.breakMinutes, 0)),
        };
        const serialized = safeJsonStringify(safe, JSON.stringify(EMPTY_TODAY_STATS), 'today-stats');
        const setOk = this._settings.set_string('today-stats', serialized);
        {
            const gio = this._settings?._settings;
            const schemaId =
                gio?.settings_schema?.get_id?.() ??
                gio?.schema_id ??
                gio?.settings_schema?.id ??
                SETTINGS_SCHEMA_ID;
            const path = gio?.path ?? gio?.get_property?.('path') ?? '(unknown)';
            let raw = null;
            try {
                raw = gio?.get_string?.('today-stats') ?? null;
            } catch (e) {
                logError(e, '[ANALYTICS-DEBUG] _setTodayStats: Gio get_string("today-stats") failed');
            }
            log(`[ANALYTICS-DEBUG] _setTodayStats wrote schemaId="${schemaId}" path="${path}" key="today-stats" setOk=${setOk} value="${serialized}" readbackSafe="${this._settings.get_string('today-stats')}" readbackGio="${raw}"`);
        }
    }

    _restoreCycleStateFromSettings() {
        log('[ANALYTICS-DEBUG] restoreCycleStateFromSettings: start (does not write history-json)');
        const idx = Math.max(0, this._settings.get_int('current-cycle-index'));
        const t = this._settings.get_int('current-session-type');
        const type = [SESSION_TYPE.FOCUS, SESSION_TYPE.SHORT_BREAK, SESSION_TYPE.LONG_BREAK].includes(t)
            ? t
            : SESSION_TYPE.FOCUS;

        this._sessionCount = idx;
        this._sessionType = type;
        this._settings.set_int('current-cycle-index', this._sessionCount);
        this._settings.set_int('current-session-type', this._sessionType);
    }

    _hydrateTodayStatsFromHistoryIfNeeded() {
        const today = this._getTodayDateString();
        const last = this._settings.get_string('last-active-date');
        if (!last || last !== today)
            return;

        const history = this._loadHistory();
        if (!history.length)
            return;

        const now = GLib.DateTime.new_now_local();
        const start = startOfLocalDay(now);
        const end = start.add_days(1);
        const stats = computeRangeStats(history, start, end);

        this._setTodayStats(stats);

        if (this._sessionCount <= 0 && stats.focusCount > 0) {
            this._sessionCount = stats.focusCount;
            this._persistCycleStateToSettings();
        }
    }

    _persistCycleStateToSettings() {
        this._settings.set_int('current-cycle-index', Math.max(0, this._sessionCount));
        this._settings.set_int('current-session-type', this._sessionType);
    }

    _getLegacyHistoryFile() {
        const path = GLib.build_filenamev([GLib.get_user_data_dir(), this._extension.uuid, 'history.json']);
        return Gio.File.new_for_path(path);
    }

    _migrateLegacyHistoryIfNeeded() {
        log('[ANALYTICS-DEBUG] migrateLegacyHistoryIfNeeded: start');
        const existing = (this._settings.get_string('history-json') ?? '').trim();
        log(`[ANALYTICS-DEBUG] migrateLegacyHistoryIfNeeded: existing history-json len=${_analyticsDebugHistoryLenFromRaw(existing)} preview="${_analyticsDebugPreview(existing)}"`);
        if (existing && existing !== '[]')
            return;

        const file = this._getLegacyHistoryFile();
        if (!file.query_exists(null))
            return;

        try {
            const contents = file.load_contents(null)[1];
            if (!contents)
                return;
            const decoded = new TextDecoder().decode(contents);
            const parsed = safeJsonParse(decoded, []);
            if (!Array.isArray(parsed))
                return;
            const oldLen = _analyticsDebugHistoryLenFromRaw(existing);
            const newLen = parsed.length;
            log(`[ANALYTICS-DEBUG] migrateLegacyHistoryIfNeeded: about to write history-json oldLen=${oldLen} newLen=${newLen}`);
            this._settings.set_string('history-json', JSON.stringify(parsed));
            const readback = this._settings.get_string('history-json');
            log(`[ANALYTICS-DEBUG] migrateLegacyHistoryIfNeeded: wrote history-json readbackPreview="${_analyticsDebugPreview(readback)}"`);
        } catch (e) {
            logError(e, '[ANALYTICS-DEBUG] migrateLegacyHistoryIfNeeded failed (ignored)');
        }
    }

    _buildMenu() {
        // Main box for the popup menu
        const menuBox = new St.BoxLayout({ vertical: true, style_class: 'fomo-doro-menu' });

        // Timer display
        const progressSize = 240;
        const innerDiameter = this._getInnerDiameter(progressSize);
        this._ringPadding = 14;
        this._timeLabel = new St.Label({
            text: '00:00',
            style_class: 'fomo-doro-time-label',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._setLabelNoEllipsize(this._timeLabel);

        // Circular progress bar
        this._progressCanvas = new St.DrawingArea({
            style_class: 'fomo-doro-progress',
            width: progressSize,
            height: progressSize,
        });
        this._progressCanvas.connect('repaint', this._onCanvasRepaint.bind(this));

        const progressContainer = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'fomo-doro-progress-container',
        });
        progressContainer.set_size(progressSize, progressSize);
        progressContainer.add_child(this._progressCanvas);
        progressContainer.add_child(this._timeLabel);
        // Keep the label perfectly centered and above the ring stroke
        this._timeLabel.set_x_align(Clutter.ActorAlign.CENTER);
        this._timeLabel.set_y_align(Clutter.ActorAlign.CENTER);
        if (progressContainer.layout_manager?.set_alignment) {
            progressContainer.layout_manager.set_alignment(
                this._progressCanvas,
                Clutter.BinAlignment.CENTER,
                Clutter.BinAlignment.CENTER
            );
            progressContainer.layout_manager.set_alignment(
                this._timeLabel,
                Clutter.BinAlignment.CENTER,
                Clutter.BinAlignment.CENTER
            );
        }
        menuBox.add_child(progressContainer);

        this._sessionLabel = new St.Label({
            text: getSessionLabel(this._sessionType),
            style_class: 'fomo-doro-session-label',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._setLabelNoEllipsize(this._sessionLabel);

        this._cycleLabel = new St.Label({
            text: '',
            style_class: 'fomo-doro-cycle-label',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._setLabelNoEllipsize(this._cycleLabel);

        this._nextSessionLabel = new St.Label({
            text: '',
            style_class: 'fomo-doro-next-label',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._setLabelNoEllipsize(this._nextSessionLabel);
        this._progressSummaryLabel = new St.Label({
            text: '',
            style_class: 'fomo-doro-progress-summary',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._setLabelNoEllipsize(this._progressSummaryLabel);

        const sessionBox = new St.BoxLayout({ vertical: true, x_align: Clutter.ActorAlign.CENTER, style_class: 'fomo-doro-session-box' });
        sessionBox.add_child(this._sessionLabel);
        sessionBox.add_child(this._cycleLabel);
        sessionBox.add_child(this._nextSessionLabel);
        sessionBox.add_child(this._progressSummaryLabel);
        menuBox.add_child(sessionBox);

        // Buttons
        const buttonBox = new St.BoxLayout({ style_class: 'fomo-doro-button-box' });
        this._startIcon = new St.Icon({
            icon_name: 'media-playback-start-symbolic',
            style_class: 'fomo-doro-button-icon',
        });
        this._pauseIcon = new St.Icon({
            icon_name: 'media-playback-pause-symbolic',
            style_class: 'fomo-doro-button-icon',
        });
        this._resetIcon = new St.Icon({
            icon_name: 'view-refresh-symbolic',
            style_class: 'fomo-doro-button-icon',
        });
        this._nextIcon = new St.Icon({
            icon_name: 'media-skip-forward-symbolic',
            style_class: 'fomo-doro-button-icon',
        });

        this._startButton = new St.Button({
            child: this._startIcon,
            style_class: 'button fomo-doro-button',
            x_expand: true,
            accessible_name: _('Play'),
        });
        this._pauseButton = new St.Button({
            child: this._pauseIcon,
            style_class: 'button fomo-doro-button',
            x_expand: true,
            reactive: false,
            accessible_name: _('Pause'),
        });
        this._nextButton = new St.Button({
            child: this._nextIcon,
            style_class: 'button fomo-doro-button',
            x_expand: true,
            accessible_name: _('Next'),
        });
        this._resetButton = new St.Button({
            child: this._resetIcon,
            style_class: 'button fomo-doro-button',
            x_expand: true,
            accessible_name: _('Refresh'),
        });

        this._startButton.connect('clicked', this._onStartClicked.bind(this));
        this._pauseButton.connect('clicked', this._onPauseClicked.bind(this));
        this._nextButton.connect('clicked', () => this._advanceSession(false));
        this._resetButton.connect('clicked', this._onResetClicked.bind(this));
        
        buttonBox.add_child(this._startButton);
        buttonBox.add_child(this._pauseButton);
        buttonBox.add_child(this._nextButton);
        buttonBox.add_child(this._resetButton);
        menuBox.add_child(buttonBox);

        const statsItem = new PopupMenu.PopupMenuItem(_('View analytics'));
        statsItem.connect('activate', () => {
            this.menu.close();
            if (this._openStatsDialogIdleId) {
                GLib.source_remove(this._openStatsDialogIdleId);
                this._openStatsDialogIdleId = null;
            }
            this._openStatsDialogIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._openStatsDialogIdleId = null;
                this._openStatsDialog();
                return GLib.SOURCE_REMOVE;
            });
        });
        this.menu.addMenuItem(statsItem);

        const menuItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        menuItem.add_child(menuBox);
        this.menu.addMenuItem(menuItem);
    }

    _onButtonPress(actor, event) {
        this._ensureDailyState({ applyRuntimeReset: true, allowDuringRun: false });
        if (event.get_button && event.get_button() === 3) {
            this._openStatsDialog();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onCanvasRepaint(canvas) {
        const cr = canvas.get_context();
        const [width, height] = canvas.get_size();
        if (!width || !height) {
            cr.$dispose();
            return;
        }
        const size = Math.min(width, height);
        const lineWidth = Math.max(12, Math.min(size * 0.08, 16));
        const innerPadding = Math.max(this._ringPadding ?? 14, lineWidth * 0.75);
        const radius = Math.max(0, (size - lineWidth) / 2 - innerPadding);
        const center_x = width / 2;
        const center_y = height / 2;

        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);
        cr.setLineWidth(lineWidth);
        cr.setLineCap(Cairo.LineCap.ROUND);

        const isFocus = this._sessionType === SESSION_TYPE.FOCUS;
        const trackColor = isFocus
            ? [0.95, 0.73, 0.73, 0.22]
            : [0.72, 0.78, 0.96, 0.22];
        // Background circle
        cr.setSourceRGBA(...trackColor);
        cr.arc(center_x, center_y, radius, 0, 2 * Math.PI);
        cr.stroke();

        if (this._timerState !== TIMER_STATE.STOPPED) {
            this._updateRemainingFromClock();
            const totalSeconds = this._getTotalSeconds();
            const remainingSeconds = this._remainingSeconds;
            const combined = this._settings.get_boolean('single-progress-bar');
            const totalCycleSeconds = this._cycleTotalSeconds || this._computeCycleTotalSeconds();
            const combinedRemaining = this._sessionType === SESSION_TYPE.FOCUS
                ? remainingSeconds + this._getNextBreakDuration()
                : remainingSeconds;
            const progress = combined
                ? combinedRemaining / Math.max(totalCycleSeconds, 1)
                : remainingSeconds / totalSeconds;
            
            // Foreground arc
            cr.setSourceRGBA(
                isFocus ? 0.94 : 0.56,
                isFocus ? 0.36 : 0.82,
                isFocus ? 0.36 : 0.96,
                0.95
            );
            cr.arc(center_x, center_y, radius, -Math.PI / 2, -Math.PI / 2 + progress * 2 * Math.PI);
            cr.stroke();
        }

        cr.$dispose();
    }

    _getInnerDiameter(size) {
        const lineWidth = Math.max(12, Math.min(size * 0.08, 16));
        const innerPadding = Math.max(this._ringPadding ?? 14, lineWidth * 0.75);
        const radius = Math.max(0, (size - lineWidth) / 2 - innerPadding);
        return Math.max(0, Math.floor(radius * 2));
    }
    
    _updateTime() {
        if (this._timerState === TIMER_STATE.RUNNING) {
            this._updateRemainingFromClock();
        } else if (this._timerState === TIMER_STATE.STOPPED) {
            this._remainingSeconds = this._getTotalSeconds();
        }
        
        this._remainingSeconds = Math.max(0, this._remainingSeconds ?? this._getTotalSeconds());
        const minutes = Math.floor(this._remainingSeconds / 60);
        const seconds = this._remainingSeconds % 60;
        this._timeLabel.text = `%02d:%02d`.format(minutes, seconds);
        this._updateSessionIndicators();
        this._progressCanvas.queue_repaint();
    }

    _getCompletedDurationSeconds(sessionType) {
        const total = this._getTotalSecondsForType(sessionType);
        const remaining = Math.max(0, this._remainingSeconds ?? total);
        const elapsed = total - remaining;
        return elapsed > 0 ? elapsed : total;
    }

    _getTotalSeconds() {
        return this._getTotalSecondsForType(this._sessionType);
    }

    _getTotalSecondsForType(sessionType) {
        switch (sessionType) {
            case SESSION_TYPE.FOCUS:
                return this._settings.get_int('focus-duration') * 60;
            case SESSION_TYPE.SHORT_BREAK:
                return this._settings.get_int('short-break-duration') * 60;
            case SESSION_TYPE.LONG_BREAK:
                return this._settings.get_int('long-break-duration') * 60;
        }
        return 0;
    }

    _getNextBreakDuration() {
        const interval = this._settings.get_int('long-break-interval');
        const nextCount = this._sessionCount + 1;
        const isLong = nextCount % interval === 0;
        return isLong
            ? this._settings.get_int('long-break-duration') * 60
            : this._settings.get_int('short-break-duration') * 60;
    }

    _computeCycleTotalSeconds() {
        if (this._sessionType === SESSION_TYPE.FOCUS)
            return this._getTotalSeconds() + this._getNextBreakDuration();
        return this._getTotalSeconds();
    }

    _startTickLoop() {
        this._clearTimerSource();
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_INTERVAL_MS, () => this._handleTick());
    }

    _handleTick() {
        try {
            if (this._timerState !== TIMER_STATE.RUNNING)
                return GLib.SOURCE_REMOVE;

            const nowMs = Date.now();
            if (this._sessionEndTimestampMs === null) {
                const seedRemainingSec = Math.max(0, Math.trunc(this._remainingSeconds ?? this._getTotalSeconds()));
                this._sessionEndTimestampMs = nowMs + seedRemainingSec * 1000;
            }

            const remainingMs = this._sessionEndTimestampMs - nowMs;

            const remainingSec = Math.max(0, Math.floor(remainingMs / 1000));

            this._lastTickLoggedRemainingSec = remainingSec;

            this._remainingSeconds = remainingSec;

            if (this._maybeFinishSession(remainingMs))
                return GLib.SOURCE_REMOVE;

            this._updateTime();
            return GLib.SOURCE_CONTINUE;
        } catch (e) {
            logError(e, '[Fomo-Doro] tick callback crashed');
            if (this._timerState !== TIMER_STATE.RUNNING)
                return GLib.SOURCE_REMOVE;
            return GLib.SOURCE_CONTINUE;
        }
    }

    _onStartClicked() {
        if (this._timerState === TIMER_STATE.RUNNING) return;

        this._ensureDailyState({ applyRuntimeReset: true, allowDuringRun: false });
        this._finishHandled = false;
        this._lastTickLoggedRemainingSec = null;
        this._cycleTotalSeconds = this._computeCycleTotalSeconds();
        this._timerState = TIMER_STATE.RUNNING;
        const remaining = Math.max(0, this._remainingSeconds ?? this._getTotalSeconds());
        this._sessionEndTimestampMs = Date.now() + remaining * 1000;
        this._startButton.reactive = false;
        this._pauseButton.reactive = true;
        this._startButton.set_accessible_name(_('Play'));
        this._updateRemainingFromClock();
        if (this._finishHandled)
            return;
        this._startTickLoop();
        this._updateTime();
    }

    _onPauseClicked() {
        if (this._timerState !== TIMER_STATE.RUNNING) return;
        this._updateRemainingFromClock();
        this._sessionEndTimestampMs = null;
        this._clearTimerSource();
        this._timerState = TIMER_STATE.PAUSED;
        this._startButton.reactive = true;
        this._startButton.set_accessible_name(_('Play'));
        this._pauseButton.reactive = false;
    }

    _onResetClicked(preserveFinishFlag = false) {
        this._clearTimerSource();
        this._sessionEndTimestampMs = null;
        this._timerState = TIMER_STATE.STOPPED;
        if (!preserveFinishFlag)
            this._finishHandled = false;
        this._startButton.reactive = true;
        this._startButton.set_accessible_name(_('Play'));
        this._pauseButton.reactive = false;
        this._cycleTotalSeconds = this._computeCycleTotalSeconds();
        this._updateTime();
    }

    _maybeFinishSession(remainingMs) {
        if (this._finishHandled)
            return true;

        if ((remainingMs ?? 0) <= 0) {
            const sessionType = this._sessionType;
            const durationSeconds = this._getCompletedDurationSeconds(sessionType);
            this._handleSessionFinished(sessionType, durationSeconds);
            return true;
        }

        return false;
    }

    _handleSessionFinished(sessionType, durationSeconds) {
        if (this._finishHandled)
            return;
        this._finishHandled = true;

        log(`[SESSION-FINISHED] type=${sessionType} durationSeconds=${durationSeconds}`);

        // A) stop the timer / remove timeout source
        try {
            this._clearTimerSource();
        } catch (e) {
            logError(e, '[Fomo-Doro] session finished: stopping timer failed');
        }
        this._timerState = TIMER_STATE.STOPPED;
        this._sessionEndTimestampMs = null;
        this._remainingSeconds = 0;

        // B) record analytics for this session
        try {
            this.onSessionFinished(sessionType, durationSeconds);
        } catch (e) {
            logError(e, '[Fomo-Doro] session finished: analytics failed');
        }

        // C) update today-stats cache
        try {
            this._getTodayStats();
        } catch (e) {
            logError(e, '[Fomo-Doro] session finished: today-stats update failed');
        }

        // D) show system notification
        try {
            this._showNotification();
        } catch (e) {
            logError(e, '[Fomo-Doro] session finished: notification failed');
        }

        // E) play alarm sound
        try {
            this._playSound();
        } catch (e) {
            logError(e, '[Fomo-Doro] session finished: alarm failed');
        }

        // F) transition automatically to the next session
        try {
            this._advanceSession(false, durationSeconds);
        } catch (e) {
            logError(e, '[Fomo-Doro] session finished: transition failed');
        }
    }

    _advanceSession(logSession, durationSeconds = null) {
        this._ensureDailyState({ applyRuntimeReset: true, allowDuringRun: false });
        const oldSessionType = this._sessionType;
        const elapsedSeconds = durationSeconds ?? this._getCompletedDurationSeconds(oldSessionType);
        this._onResetClicked(true);

        if (logSession) {
            this.onSessionFinished(oldSessionType, elapsedSeconds);
        }

        if (oldSessionType === SESSION_TYPE.FOCUS) {
            this._sessionCount++;
            if (this._sessionCount % this._settings.get_int('long-break-interval') === 0) {
                this._sessionType = SESSION_TYPE.LONG_BREAK;
            } else {
                this._sessionType = SESSION_TYPE.SHORT_BREAK;
            }
        } else {
            this._sessionType = SESSION_TYPE.FOCUS;
        }
        this._remainingSeconds = this._getTotalSeconds();
        this._cycleTotalSeconds = this._computeCycleTotalSeconds();
        this._persistCycleStateToSettings();
        this._updateTime();

        const autostart = this._settings.get_boolean('autostart-next-session');
        if (autostart && this._timerState !== TIMER_STATE.RUNNING) {
            this._onStartClicked();
        }
    }

    _getNextSessionInfo() {
        if (this._sessionType === SESSION_TYPE.FOCUS) {
            const duration = this._getNextBreakDuration();
            const nextType = (this._sessionCount + 1) % this._settings.get_int('long-break-interval') === 0
                ? SESSION_TYPE.LONG_BREAK
                : SESSION_TYPE.SHORT_BREAK;
            return { type: nextType, duration };
        }
        return { type: SESSION_TYPE.FOCUS, duration: this._settings.get_int('focus-duration') * 60 };
    }

    _updateSessionIndicators() {
        this._sessionLabel.text = getSessionLabel(this._sessionType).toUpperCase();

        const interval = Math.max(this._settings.get_int('long-break-interval'), 1);
        const focusCompleted = this._sessionCount;
        const focusIndex = this._sessionType === SESSION_TYPE.FOCUS
            ? (focusCompleted % interval) + 1
            : (focusCompleted % interval) || interval;
        const cycleNumber = Math.floor(focusCompleted / interval) + 1;
        this._cycleLabel.text = _('Cycle %d • Focus %d/%d').format(cycleNumber, focusIndex, interval);

        const next = this._getNextSessionInfo();
        const nextMinutes = Math.max(1, Math.round((next.duration ?? 0) / 60));
        this._nextSessionLabel.text = _('Next: %s (%d min)').format(getSessionLabel(next.type), nextMinutes);

        const combined = this._settings.get_boolean('single-progress-bar');
        const totalSeconds = combined
            ? (this._cycleTotalSeconds || this._computeCycleTotalSeconds())
            : this._getTotalSeconds();
        let remaining = Math.max(0, this._remainingSeconds ?? totalSeconds);
        if (combined && this._sessionType === SESSION_TYPE.FOCUS) {
            remaining += this._getNextBreakDuration();
        }
        const progressPct = Math.max(0, Math.min(100, Math.round((1 - (remaining / Math.max(totalSeconds, 1))) * 100)));
        this._progressSummaryLabel.text = _('Progress %d%%').format(progressPct);
    }

    _getHistoryFile() {
        return this._getLegacyHistoryFile();
    }

    _loadHistory() {
        const raw = this._settings.get_string('history-json');
        const parsed = safeJsonParse(raw, [], 'history-json');
        const array = Array.isArray(parsed) ? parsed : [];
        const { entries, changed } = normalizeHistory(array);

        if (changed) {
            const serialized = safeJsonStringify(entries, '[]', 'history-json');
            if (typeof raw !== 'string' || raw.trim() !== serialized) {
                log(`[ANALYTICS-DEBUG] _loadHistory: about to write history-json oldLen=${array.length} newLen=${entries.length}`);
                this._settings.set_string('history-json', serialized);
                const readback = this._settings.get_string('history-json');
                log(`[ANALYTICS-DEBUG] _loadHistory: wrote history-json readbackPreview="${_analyticsDebugPreview(readback)}"`);
            }
        }

        return entries;
    }

    _saveSession(sessionType, durationSeconds = null) {
        const totalSeconds = Math.max(1, durationSeconds ?? this._getTotalSecondsForType(sessionType));
        const durationMinutes = Math.max(1, Math.round(totalSeconds / 60));
        const entry = {
            timestamp: _nowUtcIso8601(),
            type: sessionType,
            duration: durationMinutes,
            durationSeconds: totalSeconds,
            completed: true,
        };

        log(`[ANALYTICS-DEBUG] _saveSession begin entry=${safeJsonStringify(entry, '{}', 'history entry')}`);
        {
            const safeBefore = this._settings.get_string('history-json');
            let rawBefore = null;
            try {
                rawBefore = this._settings?._settings?.get_string?.('history-json') ?? null;
            } catch (e) {
                logError(e, '[ANALYTICS-DEBUG] _saveSession: Gio get_string("history-json") BEFORE append failed');
            }
            log(`[ANALYTICS-DEBUG] _saveSession history-json BEFORE append safe="${safeBefore}" gio="${rawBefore}"`);
        }

        const history = this._loadHistory();
        const oldLen = history.length;
        history.push(entry);
        const newLen = history.length;
        const serialized = safeJsonStringify(history, '[]', 'history-json');
        log(`[ANALYTICS-DEBUG] _saveSession: about to write history-json oldLen=${oldLen} newLen=${newLen}`);
        const setOk = this._settings.set_string('history-json', serialized);
        const safeAfter = this._settings.get_string('history-json');
        log(`[ANALYTICS-DEBUG] _saveSession: after set_string history-json setOk=${setOk} readbackPreview="${_analyticsDebugPreview(safeAfter)}"`);
        const gio = this._settings?._settings;
        const schemaId =
            gio?.settings_schema?.get_id?.() ??
            gio?.schema_id ??
            gio?.settings_schema?.id ??
            SETTINGS_SCHEMA_ID;
        const path = gio?.path ?? gio?.get_property?.('path') ?? '(unknown)';
        let rawAfter = null;
        try {
            rawAfter = gio?.get_string?.('history-json') ?? null;
        } catch (e) {
            logError(e, '[ANALYTICS-DEBUG] _saveSession: Gio get_string("history-json") AFTER append failed');
        }
        log(`[ANALYTICS-DEBUG] _saveSession wrote schemaId="${schemaId}" path="${path}" key="history-json" setOk=${setOk} readbackSafePreview="${_analyticsDebugPreview(safeAfter)}" readbackGioPreview="${_analyticsDebugPreview(rawAfter)}"`);

        const now = GLib.DateTime.new_now_local();
        const start = startOfLocalDay(now);
        const end = start.add_days(1);
        const stats = computeRangeStats(history, start, end);
        this._setTodayStats(stats);

        {
            const safeToday = this._settings.get_string('today-stats');
            let rawToday = null;
            try {
                rawToday = gio?.get_string?.('today-stats') ?? null;
            } catch (e) {
                logError(e, '[ANALYTICS-DEBUG] _saveSession: Gio get_string("today-stats") readback failed');
            }
            log(`[ANALYTICS-DEBUG] _saveSession wrote schemaId="${schemaId}" path="${path}" key="today-stats" readbackSafe="${safeToday}" readbackGio="${rawToday}"`);
            _analyticsDebugDumpAnalyticsKeys(this._settings, '_saveSession after writes');
        }

        this.emit('history-updated');
    }

    _openStatsDialog() {
        try {
            if (this._statsDialog) {
                const state = this._statsDialog.state ?? this._statsDialog._state ?? null;
                const openedState = ModalDialog?.State?.OPENED ?? null;
                const openingState = ModalDialog?.State?.OPENING ?? null;
                const alreadyOpen =
                    (openedState !== null && state === openedState) ||
                    (openingState !== null && state === openingState) ||
                    Boolean((this._statsDialog.dialogLayout ?? this._statsDialog._dialogLayout ?? this._statsDialog)?.mapped);

                if (alreadyOpen)
                    return;

                try {
                    this._statsDialog.destroy();
                } catch (e) {
                    logError(e, '[Fomo-Doro] Failed to destroy stale StatsDialog');
                }
                this._statsDialog = null;
            }

            let dialog = null;
            try {
                dialog = new StatsDialog(this);
            } catch (e) {
                logError(e, '[Fomo-Doro] StatsDialog constructor failed');
                this._statsDialog = null;
                return;
            }

            this._statsDialog = dialog;
            const clearRef = () => {
                if (this._statsDialog === dialog)
                    this._statsDialog = null;
            };
            dialog.connect('closed', () => {
                clearRef();
                try {
                    dialog.destroy();
                } catch (e) {
                    logError(e, '[Fomo-Doro] StatsDialog destroy after close failed');
                }
            });
            dialog.connect('destroy', clearRef);

            const timestamp = global.get_current_time?.() ?? 0;
            let opened = false;
            try {
                opened = dialog.open(timestamp) !== false;
            } catch (e) {
                logError(e, '[Fomo-Doro] StatsDialog open failed');
                clearRef();
                try {
                    dialog.destroy();
                } catch (destroyError) {
                    logError(destroyError, '[Fomo-Doro] StatsDialog destroy after open failure failed');
                }
                return;
            }

            if (!opened) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    if (this._statsDialog !== dialog)
                        return GLib.SOURCE_REMOVE;
                    try {
                        if (dialog.open(global.get_current_time?.() ?? 0) === false) {
                            clearRef();
                            dialog.destroy();
                        }
                    } catch (e) {
                        logError(e, '[Fomo-Doro] StatsDialog open retry failed');
                        clearRef();
                        try {
                            dialog.destroy();
                        } catch (destroyError) {
                            logError(destroyError, '[Fomo-Doro] StatsDialog destroy after open retry failure failed');
                        }
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        } catch (e) {
            logError(e, '[Fomo-Doro] _openStatsDialog failed');
        }
    }

    _toLocalDate(timestamp) {
        return toLocalDateTime(timestamp);
    }

    
    _playSound() {
        if (!this._settings.get_boolean('sound-enabled'))
            return;

        const customPath = this._settings.get_string('sound-file');
        let soundFile = null;

        if (customPath) {
            const customFile = Gio.File.new_for_path(customPath);
            if (customFile.query_exists(null))
                soundFile = customFile;
        }

        if (!soundFile) {
            const bundled = this._extension?.dir?.get_child('sounds')?.get_child('nokia_message.mp3');
            if (bundled?.query_exists(null))
                soundFile = bundled;
        }

        if (!soundFile) {
            const fallback = Gio.File.new_for_path('/usr/share/sounds/freedesktop/stereo/complete.oga');
            if (fallback.query_exists(null))
                soundFile = fallback;
        }

        if (!soundFile)
            return;

        const soundPath = soundFile.get_path();
        const paplayPath = GLib.find_program_in_path('paplay');

        if (paplayPath && soundPath) {
            try {
                Gio.Subprocess.new(
                    [paplayPath, soundPath],
                    Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE
                );
                return;
            } catch (e) {
                logError(e, '[Fomo-Doro] Failed to spawn paplay');
            }
        }

        const player = global.display?.get_sound_player?.() ?? Main.soundPlayer;
        if (!player)
            return;

        try {
            player.play_from_file(soundFile, 'pomodorotimer@anasubaid.dev', null);
        } catch (e) {
            logError(e, '[Fomo-Doro] Failed to play sound');
        }
    }

    _showNotification() {
        let message = '';
        switch (this._sessionType) {
            case SESSION_TYPE.FOCUS:
                message = _("Time for a break!");
                break;
            case SESSION_TYPE.SHORT_BREAK:
            case SESSION_TYPE.LONG_BREAK:
                message = _("Time to focus!");
                break;
        }
        
        try {
            const source = new MessageTray.Source(_('Fomo-Doro Timer'), 'preferences-system-time-symbolic');
            Main.messageTray.add(source);
            const notification = new MessageTray.Notification(source, _('Fomo-Doro Timer'), message);
            notification.setTransient(true);
            source.showNotification(notification);
        } catch (e) {
            // Fallback to built-in helper to surface the alert
            Main.notify(_('Fomo-Doro Timer'), message);
        }
    }
    
    _clearTimerSource() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
    }

    _updateRemainingFromClock() {
        if (this._sessionEndTimestampMs === null) {
            this._remainingSeconds = Math.max(0, this._remainingSeconds ?? this._getTotalSeconds());
            return this._remainingSeconds;
        }

        const remainingMs = this._sessionEndTimestampMs - Date.now();
        if (remainingMs <= 0)
            this._remainingSeconds = 0;
        else
            this._remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));

        if (this._timerState === TIMER_STATE.RUNNING && this._maybeFinishSession(remainingMs))
            return 0;

        return this._remainingSeconds;
    }

    _setLabelNoEllipsize(label) {
        if (!label)
            return;
        if (label.set_x_expand) label.set_x_expand(true);
        const text = label.clutter_text ?? label.get_clutter_text?.();
        if (!text)
            return;
        text.set_ellipsize(Pango.EllipsizeMode.NONE);
        text.set_single_line_mode(true);
        text.set_line_wrap(false);
        text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
    }
    
    destroy() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
        }
        if (this._openStatsDialogIdleId) {
            GLib.source_remove(this._openStatsDialogIdleId);
            this._openStatsDialogIdleId = null;
        }
        if (this._dailyCheckId) {
            GLib.source_remove(this._dailyCheckId);
            this._dailyCheckId = null;
        }
        if (this._statsDialog) {
            this._statsDialog.destroy();
            this._statsDialog = null;
        }
        super.destroy();
    }
});

export default class FomoDoroTimerExtension extends Extension {
    enable() {
        try {
            Gettext.bindtextdomain(GETTEXT_DOMAIN, this.dir.get_child('locale').get_path());
            Gettext.textdomain(GETTEXT_DOMAIN);
            this._indicator = new FomoDoroTimerIndicator(this);
            try {
                const safe = this._indicator?._settings ?? null;
                const gio = safe?._settings ?? null;
                const schemaId =
                    gio?.settings_schema?.get_id?.() ??
                    gio?.schema_id ??
                    gio?.settings_schema?.id ??
                    SETTINGS_SCHEMA_ID;
                const path = gio?.path ?? gio?.get_property?.('path') ?? '(unknown)';
                log(`[ANALYTICS-DEBUG] enable(): Gio.Settings initialized=${Boolean(gio)} schemaId="${schemaId}" path="${path}"`);
                let safeHistory = null;
                let rawHistory = null;
                let safeToday = null;
                let rawToday = null;
                let safeLast = null;
                let rawLast = null;
                try { safeHistory = safe?.get_string?.('history-json') ?? null; } catch (e) { logError(e, '[ANALYTICS-DEBUG] enable(): Safe get_string("history-json") failed'); }
                try { rawHistory = gio?.get_string?.('history-json') ?? null; } catch (e) { logError(e, '[ANALYTICS-DEBUG] enable(): Gio get_string("history-json") failed'); }
                try { safeToday = safe?.get_string?.('today-stats') ?? null; } catch (e) { logError(e, '[ANALYTICS-DEBUG] enable(): Safe get_string("today-stats") failed'); }
                try { rawToday = gio?.get_string?.('today-stats') ?? null; } catch (e) { logError(e, '[ANALYTICS-DEBUG] enable(): Gio get_string("today-stats") failed'); }
                try { safeLast = safe?.get_string?.('last-active-date') ?? null; } catch (e) { logError(e, '[ANALYTICS-DEBUG] enable(): Safe get_string("last-active-date") failed'); }
                try { rawLast = gio?.get_string?.('last-active-date') ?? null; } catch (e) { logError(e, '[ANALYTICS-DEBUG] enable(): Gio get_string("last-active-date") failed'); }
                log(`[ANALYTICS-DEBUG] enable(): history-json safe="${safeHistory}" gio="${rawHistory}"`);
                log(`[ANALYTICS-DEBUG] enable(): today-stats safe="${safeToday}" gio="${rawToday}"`);
                log(`[ANALYTICS-DEBUG] enable(): last-active-date safe="${safeLast}" gio="${rawLast}"`);
                _analyticsDebugDumpAnalyticsKeys(safe, 'enable()');
            } catch (e) {
                logError(e, '[ANALYTICS-DEBUG] enable(): analytics settings diagnostics crashed');
            }
            Main.panel.addToStatusArea(this.uuid, this._indicator);
        } catch (e) {
            this._indicator = null;
            logError(e, '[Fomo-Doro] Extension failed to enable (see logs for details).');
            logError(e, '[ANALYTICS-DEBUG] enable(): extension enable threw');
        }
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
