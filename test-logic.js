import GLib from 'gi://GLib';
import {DataStore} from './stores.js';
import {TimerEngine} from './timer.js';

class MockSettings {
    constructor() {
        this.map = new Map([
            ['focus-duration', 25],
            ['short-break-duration', 5],
            ['long-break-duration', 15],
            ['long-break-interval', 4],
            ['daily-goal', 8],
            ['show-countdown', true],
            ['auto-open-on-completion', true],
            ['autostart-next-session', false],
            ['sound-choice', 'bundled'],
            ['single-progress-bar', false],
            ['preset', 'custom'],
        ]);
        this.settings_schema = {has_key: () => true};
    }
    get_int(k, fb = 0) { return this.map.has(k) ? this.map.get(k) : fb; }
    get_boolean(k, fb = false) { return this.map.has(k) ? this.map.get(k) : fb; }
    get_string(k, fb = '') { return this.map.has(k) ? this.map.get(k) : fb; }
    set_int(k, v) { this.map.set(k, v); return true; }
    set_boolean(k, v) { this.map.set(k, v); return true; }
    set_string(k, v) { this.map.set(k, v); return true; }
}

let failures = 0;
const check = (cond, msg) => {
    if (cond) {
        print(`PASS: ${msg}`);
    } else {
        print(`FAIL: ${msg}`);
        failures++;
    }
};

const settings = new MockSettings();
const store = new DataStore(settings);
const engine = new TimerEngine(store, {
    onChange: () => {},
    onCompleted: () => {},
});

check(engine.phase === 'idle', 'starts idle');
check(engine.timeString() === '25:00', 'idle shows 25:00');
engine.startFocus();
check(engine.phase === 'running' && engine.kind === 'focus', 'startFocus → running focus');
check(engine.remainingSeconds === 1500, 'focus duration 25 min = 1500s');
engine.togglePause();
check(engine.phase === 'paused', 'togglePause → paused');
const pausedRemaining = engine.remainingSeconds;
engine.togglePause();
check(engine.phase === 'running', 'unpause → running');
check(Math.abs(engine.remainingSeconds - pausedRemaining) <= 1, 'remaining preserved across pause');

const task = store.addTask('Design Poster', 4);
check(task.estimate === 4, 'task estimate stored');
engine.setActiveTask(task);
check(engine.activeTask?.title === 'Design Poster', 'active task set');

engine._remainingMs = 100;
engine._endMs = Date.now() + 50;
const loop = new GLib.MainLoop(null, false);
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
    loop.quit();
    return GLib.SOURCE_REMOVE;
});
loop.run();

check(engine.cycleCount === 1, 'natural focus completion increments cycle');
check(task.completed === 1, 'active task completed incremented');
check(engine.justCompleted !== null, 'completion banner set on natural focus end');
check(engine.justCompleted?.taskTitle === 'Design Poster', 'banner carries task title');
check(store.getSessions().length === 1, 'session recorded');
check(engine.phase === 'idle', 'autostart off → idle after focus');
check(engine.cycleDots === 1, 'cycle dots = 1 after one focus');

engine.startFocus();
engine.skip();
check(engine.cycleCount === 2, 'manual next counts the focus');
check(engine.kind === 'shortBreak', 'manual next advances focus → short break');
check(engine.justCompleted === null, 'manual next does not set banner');
check(store.getSessions().length === 2, 'manual next records the session');
engine.skip();
check(engine.kind === 'focus', 'manual next advances break → focus');

for (let i = 0; i < 3; i++) {
    engine.startFocus();
    engine.skip();
}
check(engine.cycleCount === 5, 'cycle count 5 after 5 focus sessions');
check(engine.kind === 'shortBreak', '5th focus → short break');

engine.reset();
check(engine.phase === 'idle' && engine.cycleCount === 0, 'reset clears cycle');
check(engine.activeTask === null, 'reset clears active task');

const today = store.statsToday();
check(today.sessions === 5, `statsToday.sessions = 5 (got ${today.sessions})`);
check(today.focusMinutes === 5 * 25, `statsToday.focusMinutes = 125 (got ${today.focusMinutes})`);
check(store.streak() >= 1, 'streak ≥ 1');
check(store.last7Days().length === 7, 'last7Days has 7 entries');
check(store.allTimeSeconds() === 5 * 1500, 'allTime = 5 focus sessions');

store.applyPreset('deep-work');
check(store.focusDuration === 50 && store.shortBreakDuration === 10, 'deep-work preset applies 50/10');
check(store.currentPreset() === 'deep-work', 'currentPreset detected');

store.setNotes('hello world');
check(store.getNotes() === 'hello world', 'notes roundtrip');

const state = store.loadTimerState();
check(typeof state.cycleCount === 'number', 'timer state persisted');

engine.destroy();
print(failures === 0 ? 'ALL TESTS PASSED' : `${failures} FAILURES`);
if (failures > 0)
    throw new Error(`${failures} test failures`);
