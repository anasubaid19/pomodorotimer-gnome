'use strict';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const SESSION_TYPE = {
    FOCUS: 'focus',
    SHORT_BREAK: 'shortBreak',
    LONG_BREAK: 'longBreak',
};

export const KIND_LABEL = {
    [SESSION_TYPE.FOCUS]: 'Focus',
    [SESSION_TYPE.SHORT_BREAK]: 'Short Break',
    [SESSION_TYPE.LONG_BREAK]: 'Long Break',
};

const safeJsonParse = (value, fallback, context = 'JSON') => {
    if (typeof value !== 'string' || !value.trim())
        return fallback;
    try {
        const parsed = JSON.parse(value);
        return parsed ?? fallback;
    } catch (e) {
        logError(e, `[FomoDoro] Failed to parse ${context}`);
        return fallback;
    }
};

const safeJsonStringify = (value, fallback, context = 'JSON') => {
    try {
        return JSON.stringify(value);
    } catch (e) {
        logError(e, `[FomoDoro] Failed to serialize ${context}`);
        return fallback;
    }
};

class SafeSettings {
    constructor(settings) {
        this._settings = settings ?? null;
        this._schema = this._settings?.settings_schema ?? null;
    }

    _hasKey(key) {
        try {
            return this._schema?.has_key ? this._schema.has_key(key) : false;
        } catch (e) {
            return false;
        }
    }

    get_int(key, fallback = 0) {
        if (!this._settings || !this._hasKey(key))
            return fallback;
        try {
            const v = this._settings.get_int(key);
            return Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    get_boolean(key, fallback = false) {
        if (!this._settings || !this._hasKey(key))
            return fallback;
        try {
            return Boolean(this._settings.get_boolean(key));
        } catch (e) {
            return fallback;
        }
    }

    get_string(key, fallback = '') {
        if (!this._settings || !this._hasKey(key))
            return fallback;
        try {
            return typeof this._settings.get_string(key) === 'string'
                ? this._settings.get_string(key)
                : fallback;
        } catch (e) {
            return fallback;
        }
    }

    set_int(key, value) {
        if (!this._settings || !this._hasKey(key))
            return false;
        try {
            return this._settings.set_int(key, Math.trunc(Number(value)));
        } catch (e) {
            return false;
        }
    }

    set_boolean(key, value) {
        if (!this._settings || !this._hasKey(key))
            return false;
        try {
            return this._settings.set_boolean(key, Boolean(value));
        } catch (e) {
            return false;
        }
    }

    set_string(key, value) {
        if (!this._settings || !this._hasKey(key))
            return false;
        try {
            return this._settings.set_string(key, String(value ?? ''));
        } catch (e) {
            return false;
        }
    }
}

/**
 * All app data + settings, backed by GSettings JSON strings.
 * Pure Gio — no Shell dependencies.
 */
export class DataStore {
    constructor(settings) {
        this.settings = new SafeSettings(settings);
    }

    // --- settings accessors ---
    get focusDuration() { return this.settings.get_int('focus-duration', 25); }
    get shortBreakDuration() { return this.settings.get_int('short-break-duration', 5); }
    get longBreakDuration() { return this.settings.get_int('long-break-duration', 15); }
    get longBreakInterval() { return this.settings.get_int('long-break-interval', 4); }
    get autostartNext() { return this.settings.get_boolean('autostart-next-session', false); }
    get showCountdown() { return this.settings.get_boolean('show-countdown', true); }
    get autoOpenOnCompletion() { return this.settings.get_boolean('auto-open-on-completion', true); }
    get singleProgressBar() { return this.settings.get_boolean('single-progress-bar', false); }
    get dailyGoal() { return this.settings.get_int('daily-goal', 8); }
    set dailyGoal(v) { this.settings.set_int('daily-goal', v); }
    get soundChoice() { return this.settings.get_string('sound-choice', 'bundled'); }
    set soundChoice(v) { this.settings.set_string('sound-choice', v); }
    get preset() { return this.settings.get_string('preset', 'custom'); }

    setDuration(kind, minutes) {
        const key = kind === SESSION_TYPE.FOCUS ? 'focus-duration'
            : kind === SESSION_TYPE.SHORT_BREAK ? 'short-break-duration'
            : 'long-break-duration';
        this.settings.set_int(key, minutes);
        if (kind === SESSION_TYPE.FOCUS || kind === SESSION_TYPE.SHORT_BREAK)
            this.settings.set_string('preset', 'custom');
    }

    applyPreset(preset) {
        const presets = {
            classic: {focus: 25, short: 5},
            'deep-work': {focus: 50, short: 10},
            sprint: {focus: 15, short: 3},
        };
        const p = presets[preset];
        if (!p)
            return;
        this.settings.set_int('focus-duration', p.focus);
        this.settings.set_int('short-break-duration', p.short);
        this.settings.set_int('long-break-duration', 15);
        this.settings.set_string('preset', preset);
    }

    currentPreset() {
        const presets = {
            classic: {focus: 25, short: 5},
            'deep-work': {focus: 50, short: 10},
            sprint: {focus: 15, short: 3},
        };
        for (const name of Object.keys(presets)) {
            const p = presets[name];
            if (p.focus === this.focusDuration && p.short === this.shortBreakDuration && this.longBreakDuration === 15)
                return name;
        }
        return 'custom';
    }

    // --- generic JSON key helpers ---
    _loadJSON(key, fallback) {
        return safeJsonParse(this.settings.get_string(key), fallback, key);
    }

    _saveJSON(key, value) {
        this.settings.set_string(key, safeJsonStringify(value, '', key));
    }

    // --- tasks ---
    getTasks() {
        return this._loadJSON('tasks-json', []);
    }

    addTask(title, estimate) {
        const tasks = this.getTasks();
        const task = {
            id: GLib.uuid_string_random(),
            title,
            estimate: Math.max(1, Math.min(20, estimate || 1)),
            completed: 0,
            done: false,
            createdAt: new Date().toISOString(),
        };
        tasks.push(task);
        this._saveJSON('tasks-json', tasks);
        return task;
    }

    updateTask(id, patch) {
        const tasks = this.getTasks();
        const task = tasks.find(t => t.id === id);
        if (!task)
            return null;
        Object.assign(task, patch);
        this._saveJSON('tasks-json', tasks);
        return task;
    }

    deleteTask(id) {
        this._saveJSON('tasks-json', this.getTasks().filter(t => t.id !== id));
    }

    // --- sessions / history ---
    getSessions() {
        return this._loadJSON('history-json', []);
    }

    addSession(kind, durationSeconds, taskTitle) {
        const sessions = this.getSessions();
        sessions.push({
            id: GLib.uuid_string_random(),
            kind,
            start: new Date().toISOString(),
            durationSeconds,
            taskTitle: taskTitle || null,
        });
        this._saveJSON('history-json', sessions);
        this.settings.set_string('last-active-date', this._dayKey(new Date()));
    }

    // --- notes ---
    getNotes() {
        return this.settings.get_string('notes', '');
    }

    setNotes(text) {
        this.settings.set_string('notes', text);
    }

    // --- timer state persistence ---
    loadTimerState() {
        return this._loadJSON('timer-state', {
            kind: null,
            paused: false,
            remaining: 0,
            cycleCount: 0,
        });
    }

    saveTimerState(state) {
        this._saveJSON('timer-state', state);
    }

    // --- stats ---
    _dayKey(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    _startOfDay(date) {
        const out = new Date(date);
        out.setHours(0, 0, 0, 0);
        return out;
    }

    todaySessions() {
        const today = this._dayKey(new Date());
        return this.getSessions().filter(s => this._dayKey(new Date(s.start)) === today);
    }

    focusToday() {
        return this.todaySessions().filter(s => s.kind === SESSION_TYPE.FOCUS);
    }

    statsToday() {
        const today = this.todaySessions();
        const focus = today.filter(s => s.kind === SESSION_TYPE.FOCUS);
        const breaks = today.filter(s => s.kind !== SESSION_TYPE.FOCUS);
        const sum = (arr) => arr.reduce((acc, s) => acc + (s.durationSeconds || 0), 0);
        return {
            sessions: focus.length,
            focusMinutes: Math.round(sum(focus) / 60),
            breakMinutes: Math.round(sum(breaks) / 60),
            tasksDone: this.getTasks().filter(t => t.done).length,
        };
    }

    allTimeSeconds() {
        const sum = (arr) => arr.reduce((acc, s) => acc + (s.durationSeconds || 0), 0);
        return sum(this.getSessions().filter(s => s.kind === SESSION_TYPE.FOCUS));
    }

    streak() {
        const days = new Set();
        for (const s of this.getSessions()) {
            if (s.kind === SESSION_TYPE.FOCUS)
                days.add(this._dayKey(new Date(s.start)));
        }
        let streak = 0;
        const today = this._startOfDay(new Date());
        let cursor = days.has(this._dayKey(today)) ? today : new Date(today.getTime() - 86400000);
        while (days.has(this._dayKey(cursor))) {
            streak += 1;
            cursor = new Date(cursor.getTime() - 86400000);
        }
        return streak;
    }

    last7Days() {
        const out = [];
        const dayFormatter = (date) => GLib.DateTime.new_from_unix_local(Math.floor(date.getTime() / 1000))
            .format('%a');
        for (let i = 6; i >= 0; i--) {
            const dayStart = new Date(this._startOfDay(new Date()).getTime() - i * 86400000);
            const dayEnd = new Date(dayStart.getTime() + 86400000);
            let minutes = 0;
            for (const s of this.getSessions()) {
                if (s.kind !== SESSION_TYPE.FOCUS)
                    continue;
                const start = new Date(s.start);
                if (start >= dayStart && start < dayEnd)
                    minutes += Math.round((s.durationSeconds || 0) / 60);
            }
            out.push({label: dayFormatter(dayStart), minutes});
        }
        return out;
    }
}
