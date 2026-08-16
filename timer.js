'use strict';

import GLib from 'gi://GLib';
import {SESSION_TYPE} from './stores.js';

const FOCUS = SESSION_TYPE.FOCUS;
const SHORT_BREAK = SESSION_TYPE.SHORT_BREAK;
const LONG_BREAK = SESSION_TYPE.LONG_BREAK;

/**
 * Pomodoro state machine. Pure logic — no Shell dependencies.
 * Wall-clock based tick (100 ms) so the countdown stays accurate.
 */
export class TimerEngine {
    constructor(store, callbacks = {}) {
        this.store = store;
        this.onChange = callbacks.onChange ?? (() => {});
        this.onCompleted = callbacks.onCompleted ?? (() => {});

        this._kind = null;
        this._paused = false;
        this._remainingMs = 0;
        this._endMs = null;
        this._cycleCount = 0;
        this.activeTask = null;
        this.justCompleted = null;

        this._timeoutId = 0;
        this._restore();
        this._tickLoop();
    }

    destroy() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    // --- public state ---
    get phase() {
        if (this._kind === null)
            return 'idle';
        return this._paused ? 'paused' : 'running';
    }

    get kind() { return this._kind; }
    get isRunning() { return this._kind !== null && !this._paused; }

    get remainingSeconds() {
        return Math.max(0, Math.ceil(this._remainingMs / 1000));
    }

    get totalMs() { return this.durationMs(this._kind ?? FOCUS); }

    get progress() {
        const total = this.totalMs;
        if (total <= 0)
            return 0;
        return Math.min(1, Math.max(0, this._remainingMs / total));
    }

    get cycleCount() { return this._cycleCount; }

    get cycleDots() {
        return this._cycleCount % this.store.longBreakInterval;
    }

    durationMs(kind) {
        switch (kind) {
        case FOCUS: return this.store.focusDuration * 60000;
        case SHORT_BREAK: return this.store.shortBreakDuration * 60000;
        case LONG_BREAK: return this.store.longBreakDuration * 60000;
        default: return 0;
        }
    }

    timeString() {
        const s = this.remainingSeconds;
        const m = Math.floor(s / 60);
        const r = s % 60;
        return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
    }

    panelText() {
        if (this.justCompleted && this._kind === null)
            return '🍅 ✓';
        if (!this.store.showCountdown)
            return '🍅';
        if (this._kind === null)
            return '🍅';
        return `${this._paused ? '⏸' : '🍅'} ${this.timeString()}`;
    }

    // --- actions ---
    startFocus() {
        this.justCompleted = null;
        this._kind = FOCUS;
        this._paused = false;
        this._remainingMs = this.durationMs(FOCUS);
        this._endMs = Date.now() + this._remainingMs;
        this._persist();
        this.onChange();
    }

    startBreak(kind) {
        this._kind = kind;
        this._paused = false;
        this._remainingMs = this.durationMs(kind);
        this._endMs = Date.now() + this._remainingMs;
        this._persist();
        this.onChange();
    }

    togglePause() {
        if (this._kind === null) {
            this.startFocus();
            return;
        }
        if (this._paused) {
            this._paused = false;
            this._endMs = Date.now() + this._remainingMs;
        } else {
            this._paused = true;
            this._remainingMs = Math.max(0, this._endMs - Date.now());
            this._endMs = null;
        }
        this._persist();
        this.onChange();
    }

    skip() {
        this.justCompleted = null;
        if (this._kind === null) {
            this.startFocus();
            return;
        }
        this._recordAndAdvance(true);
    }

    reset() {
        this._kind = null;
        this._paused = false;
        this._remainingMs = this.durationMs(FOCUS);
        this._endMs = null;
        this._cycleCount = 0;
        this.activeTask = null;
        this.justCompleted = null;
        this._persist();
        this.onChange();
    }

    dismissCompletion() {
        this.justCompleted = null;
        this.onChange();
    }

    setActiveTask(task) {
        this.activeTask = task;
        this.onChange();
    }

    // --- internals ---
    _tickLoop() {
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _tick() {
        if (!this.isRunning || this._endMs === null)
            return;
        const prevSecond = this.remainingSeconds;
        this._remainingMs = Math.max(0, this._endMs - Date.now());
        if (this._remainingMs <= 0) {
            this._remainingMs = 0;
            this._completeNatural();
        } else {
            if (this.remainingSeconds !== prevSecond)
                this._persist();
            this.onChange();
        }
    }

    _completeNatural() {
        this._recordAndAdvance(false);
    }

    _recordAndAdvance(manual) {
        const kind = this._kind;
        const durationSeconds = Math.round(this.durationMs(kind) / 1000);
        const session = {
            kind,
            durationSeconds,
            taskTitle: this.activeTask?.title ?? null,
        };
        this.store.addSession(kind, durationSeconds, session.taskTitle);

        if (kind === FOCUS) {
            this._cycleCount++;
            if (this.activeTask) {
                this.activeTask.completed = (this.activeTask.completed || 0) + 1;
                if (this.activeTask.estimate > 0 &&
                    this.activeTask.completed >= this.activeTask.estimate)
                    this.activeTask.done = true;
                this.store.updateTask(this.activeTask.id, {
                    completed: this.activeTask.completed,
                    done: this.activeTask.done,
                });
            }
            if (!manual)
                this.justCompleted = session;
        }

        this.onCompleted(session, manual);

        if (kind === FOCUS) {
            if (this._cycleCount % this.store.longBreakInterval === 0) {
                this.startBreak(LONG_BREAK);
            } else if (manual || this.store.autostartNext) {
                this.startBreak(SHORT_BREAK);
            } else {
                this._toIdle();
            }
        } else {
            if (manual || this.store.autostartNext) {
                this.startFocus();
            } else {
                this._toIdle();
            }
        }
        this._persist();
        this.onChange();
    }

    _toIdle() {
        this._kind = null;
        this._paused = false;
        this._remainingMs = this.durationMs(FOCUS);
        this._endMs = null;
    }

    _persist() {
        this.store.saveTimerState({
            kind: this._kind,
            paused: this._paused,
            remaining: Math.round(this._remainingMs),
            cycleCount: this._cycleCount,
        });
    }

    _restore() {
        const state = this.store.loadTimerState();
        if (state.kind && state.remaining > 0) {
            this._kind = state.kind;
            this._paused = Boolean(state.paused);
            this._remainingMs = Number(state.remaining);
            this._cycleCount = Number(state.cycleCount) || 0;
            if (!this._paused)
                this._endMs = Date.now() + this._remainingMs;
        } else {
            this._remainingMs = this.durationMs(FOCUS);
        }
    }
}
