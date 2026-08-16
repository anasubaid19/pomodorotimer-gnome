'use strict';

import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cairo from 'cairo';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {SESSION_TYPE, KIND_LABEL} from './stores.js';

const FOCUS = SESSION_TYPE.FOCUS;

const ACCENT = {r: 0.94, g: 0.36, b: 0.36};
const BREAK_COLOR = {r: 0.36, g: 0.72, b: 0.98};

const SOUND_OPTIONS = [
    {id: 'none', label: _('None')},
    {id: 'bundled', label: _('Bundled')},
    {id: 'freedesktop:complete', label: _('Complete')},
    {id: 'freedesktop:bell', label: _('Bell')},
    {id: 'freedesktop:message', label: _('Message')},
];

const PRESET_OPTIONS = [
    {id: 'classic', label: _('Classic — 25/5')},
    {id: 'deep-work', label: _('Deep Work — 50/10')},
    {id: 'sprint', label: _('Sprint — 15/3')},
    {id: 'custom', label: _('Custom')},
];

export class FomoDoroPopup extends St.BoxLayout {
    constructor(engine, store, soundPlayer) {
        super({vertical: true, style_class: 'fomodoro-popup'});
        this._engine = engine;
        this._store = store;
        this._soundPlayer = soundPlayer;
        this._tab = 'tasks';
        this._adding = false;
        this._noteSaveId = 0;
        this.set_width_request(360);

        this._buildHeader();
        this._buildTabs();
        this._buildContent();
        this.refresh();
    }

    destroy() {
        if (this._noteSaveId) {
            GLib.source_remove(this._noteSaveId);
            this._noteSaveId = 0;
        }
        super.destroy();
    }

    // Called by the extension whenever engine/store state changes.
    refresh() {
        this._refreshHeader();
        this._refreshTasks();
        this._refreshStats();
        this._refreshSettingsState();
    }

    // ================= Header =================
    _buildHeader() {
        const header = new St.BoxLayout({vertical: true, style_class: 'fomodoro-header'});

        const top = new St.BoxLayout({vertical: false, x_align: Clutter.ActorAlign.CENTER});
        top.add_child(this._buildRing());

        const right = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.START});
        this._timeLabel = new St.Label({
            text: '25:00',
            style_class: 'fomodoro-time',
            x_align: Clutter.ActorAlign.START,
        });
        this._phaseLabel = new St.Label({
            text: _('Focus'),
            style_class: 'fomodoro-phase',
            x_align: Clutter.ActorAlign.START,
        });
        this._dotsLabel = new St.Label({
            text: '● ● ○ ○  ·  0 of 4',
            style_class: 'fomodoro-dots',
            x_align: Clutter.ActorAlign.START,
        });
        right.add_child(this._timeLabel);
        right.add_child(this._phaseLabel);
        right.add_child(this._dotsLabel);
        top.add_child(right);
        header.add_child(top);

        this._activeTaskLabel = new St.Label({
            text: _('No active task'),
            style_class: 'fomodoro-active-task',
        });
        header.add_child(this._activeTaskLabel);

        // Controls
        const controls = new St.BoxLayout({vertical: false, x_align: Clutter.ActorAlign.CENTER, style_class: 'fomodoro-controls'});
        this._playBtn = this._iconButton('media-playback-start-symbolic', () => this._engine.togglePause(), _('Start focus'));
        const skipBtn = this._iconButton('media-skip-forward-symbolic', () => this._engine.skip(), _('Skip to next session'));
        const resetBtn = this._iconButton('media-seek-backward-symbolic', () => this._engine.reset(), _('Reset timer'));
        controls.add_child(this._playBtn);
        controls.add_child(skipBtn);
        controls.add_child(resetBtn);
        header.add_child(controls);

        // Completion banner
        this._bannerBox = new St.BoxLayout({vertical: true, style_class: 'fomodoro-banner', visible: false});
        this._bannerTitle = new St.Label({text: _('Focus complete 🎉'), style_class: 'fomodoro-banner-title'});
        const bannerRow = new St.BoxLayout({vertical: false, x_expand: true});
        this._bannerTask = new St.Label({style_class: 'fomodoro-caption'});
        const startBreakBtn = this._textButton(_('Start Break'), () => {
            this._engine.startBreak(SESSION_TYPE.SHORT_BREAK);
            this._engine.dismissCompletion();
        });
        const doneBtn = this._textButton(_('Done'), () => this._engine.dismissCompletion());
        bannerRow.add_child(this._bannerTask, {x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        bannerRow.add_child(startBreakBtn);
        bannerRow.add_child(doneBtn);
        this._bannerBox.add_child(this._bannerTitle);
        this._bannerBox.add_child(bannerRow);
        header.add_child(this._bannerBox);

        this.add_child(header);
    }

    _buildRing() {
        this._ring = new St.DrawingArea({width: 110, height: 110, style_class: 'fomodoro-ring'});
        this._ring.connect('repaint', () => this._drawRing(this._ring));
        return this._ring;
    }

    _drawRing(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        if (width <= 0 || height <= 0) {
            cr.$dispose();
            return;
        }
        const size = Math.min(width, height);
        const lineWidth = 12;
        const radius = Math.max(0, (size - lineWidth) / 2 - 8);
        const cx = width / 2;
        const cy = height / 2;
        const isFocus = this._engine.kind === FOCUS;
        const accent = isFocus ? ACCENT : BREAK_COLOR;

        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);
        cr.setLineWidth(lineWidth);
        cr.setLineCap(Cairo.LineCap.ROUND);

        cr.setSourceRGBA(0.5, 0.5, 0.5, 0.18);
        cr.arc(cx, cy, radius, 0, 2 * Math.PI);
        cr.stroke();

        if (this._engine.kind !== null || this._engine.phase === 'running' || this._engine.phase === 'paused') {
            cr.setSourceRGBA(accent.r, accent.g, accent.b, 0.95);
            cr.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + this._engine.progress * 2 * Math.PI);
            cr.stroke();
        }
        cr.$dispose();
    }

    _iconButton(iconName, onClick, label) {
        const btn = new St.Button({style_class: 'fomodoro-icon-button', reactive: true, can_focus: true});
        btn.add_child(new St.Icon({icon_name: iconName, style_class: 'popup-menu-icon'}));
        btn.set_accessible_name(label);
        btn.connect('clicked', onClick);
        return btn;
    }

    _textButton(text, onClick) {
        const btn = new St.Button({label: text, style_class: 'fomodoro-text-button', reactive: true, can_focus: true});
        btn.connect('clicked', onClick);
        return btn;
    }

    _refreshHeader() {
        this._timeLabel.set_text(this._engine.timeString());
        const kind = this._engine.kind;
        const phaseText = this._engine.phase === 'idle'
            ? (this._engine.justCompleted ? _('Focus complete 🎉') : _('Focus'))
            : (KIND_LABEL[kind] ?? _('Focus'));
        this._phaseLabel.set_text(phaseText);

        const dots = this._engine.cycleDots;
        const interval = this._store.longBreakInterval;
        let dotsText = '';
        for (let i = 0; i < interval; i++)
            dotsText += i < dots ? '● ' : '○ ';
        dotsText += `  ${dots} of ${interval}`;
        this._dotsLabel.set_text(dotsText);
        this._dotsLabel.set_tooltip_text(_(`Pomodoro ${dots} of ${interval} before long break`));

        const task = this._engine.activeTask;
        this._activeTaskLabel.set_text(task ? task.title : _('No active task'));

        this._playBtn.get_child().set_icon_name(
            this._engine.phase === 'running' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic');
        this._playBtn.set_accessible_name(this._engine.phase === 'running' ? _('Pause') : _('Start focus'));

        const completed = this._engine.justCompleted;
        this._bannerBox.set_visible(completed !== null);
        if (completed) {
            this._bannerTitle.set_text(_('Focus complete 🎉'));
            this._bannerTask.set_text(completed.taskTitle
                ? `${completed.taskTitle} — ${Math.round(completed.durationSeconds / 60)} min focused`
                : '');
        }
        this._ring.queue_repaint();
    }

    // ================= Tabs =================
    _buildTabs() {
        const tabs = new St.BoxLayout({vertical: false, x_align: Clutter.ActorAlign.FILL, style_class: 'fomodoro-tabs'});
        const defs = [
            {id: 'tasks', label: _('Tasks')},
            {id: 'notes', label: _('Notes')},
            {id: 'stats', label: _('Stats')},
            {id: 'settings', label: _('Settings')},
        ];
        this._tabButtons = {};
        for (const def of defs) {
            const btn = new St.Button({label: def.label, reactive: true, can_focus: true});
            btn.connect('clicked', () => this._switchTab(def.id));
            this._tabButtons[def.id] = btn;
            tabs.add_child(btn, {x_expand: true, x_fill: true});
        }
        this.add_child(tabs);
    }

    _switchTab(id) {
        this._tab = id;
        for (const tabId of Object.keys(this._tabButtons)) {
            const active = tabId === id;
            this._tabButtons[tabId].style_class = active ? 'fomodoro-tab-active' : 'fomodoro-tab';
            this._tabButtons[tabId].set_accessible_name(tabId === 'tasks' ? _('Tasks tab') :
                tabId === 'notes' ? _('Notes tab') : tabId === 'stats' ? _('Stats tab') : _('Settings tab'));
        }
        for (const key of Object.keys(this._views))
            this._views[key].set_visible(key === id);
        this._refresh();
    }

    // ================= Content =================
    _buildContent() {
        this._views = {};
        this._views.tasks = this._buildTasksView();
        this._views.notes = this._buildNotesView();
        this._views.stats = this._buildStatsView();
        this._views.settings = this._buildSettingsView();

        const content = new St.BoxLayout({vertical: true});
        for (const key of Object.keys(this._views))
            content.add_child(this._views[key]);
        this.add_child(content, {y_expand: true, y_fill: true});
        this._switchTab('tasks');
    }

    // ---------------- Tasks ----------------
    _buildTasksView() {
        const view = new St.BoxLayout({vertical: true, visible: true, style_class: 'fomodoro-view'});

        this._addButton = new St.Button({
            label: _('＋ Add Task'),
            style_class: 'fomodoro-add-button',
            reactive: true,
            can_focus: true,
            x_align: Clutter.ActorAlign.START,
        });
        this._addButton.connect('clicked', () => this._beginAdding());
        view.add_child(this._addButton);

        this._addForm = new St.BoxLayout({vertical: true, visible: false, style_class: 'fomodoro-add-form'});
        this._taskEntry = new St.Entry({
            hint_text: _('Task name'),
            can_focus: true,
            style_class: 'fomodoro-entry',
        });
        this._taskEntry.connect('activate', () => this._commitTask());
        const formRow = new St.BoxLayout({vertical: false});
        this._estimateLabel = new St.Label({text: _('Sessions: 1'), style_class: 'fomodoro-caption'});
        const minusBtn = this._textButton('−', () => this._adjustEstimate(-1));
        const plusBtn = this._textButton('＋', () => this._adjustEstimate(1));
        const addBtn = this._textButton(_('Add'), () => this._commitTask());
        const cancelBtn = this._textButton(_('Cancel'), () => this._cancelAdding());
        formRow.add_child(this._estimateLabel);
        formRow.add_child(minusBtn);
        formRow.add_child(plusBtn);
        formRow.add_child(addBtn);
        formRow.add_child(cancelBtn);
        this._addForm.add_child(this._taskEntry);
        this._addForm.add_child(formRow);
        view.add_child(this._addForm);

        this._taskList = new St.BoxLayout({vertical: true, style_class: 'fomodoro-task-list'});
        view.add_child(this._taskList, {y_expand: true, y_fill: true});
        return view;
    }

    _beginAdding() {
        this._adding = true;
        this._estimate = 1;
        this._taskEntry.set_text('');
        this._addButton.set_visible(false);
        this._addForm.set_visible(true);
        this._estimateLabel.set_text(_('Sessions: 1'));
        this._taskEntry.grab_key_focus();
    }

    _cancelAdding() {
        this._adding = false;
        this._addButton.set_visible(true);
        this._addForm.set_visible(false);
    }

    _adjustEstimate(delta) {
        this._estimate = Math.min(20, Math.max(1, (this._estimate ?? 1) + delta));
        this._estimateLabel.set_text(`Sessions: ${this._estimate}`);
    }

    _commitTask() {
        const title = this._taskEntry.get_text().trim();
        if (!title)
            return;
        this._store.addTask(title, this._estimate);
        this._cancelAdding();
        this._refreshTasks();
    }

    _refreshTasks() {
        if (!this._taskList)
            return;
        this._taskList.destroy_all_children();
        const tasks = this._store.getTasks();
        const activeTaskId = this._engine.activeTask?.id ?? null;

        for (const task of tasks) {
            const row = new St.BoxLayout({vertical: false, style_class: 'fomodoro-task-row', reactive: true});
            if (activeTaskId === task.id)
                row.add_style_class_name('fomodoro-task-row-active');

            const doneBtn = this._iconButton(
                task.done ? 'emblem-default-symbolic' : 'dialog-question-symbolic',
                () => {
                    this._store.updateTask(task.id, {done: !task.done});
                    this._refreshTasks();
                },
                task.done ? _('Mark not done') : _('Mark done'));

            const textCol = new St.BoxLayout({vertical: true, x_expand: true});
            const title = new St.Label({text: task.title, style_class: 'fomodoro-task-title', x_expand: true});
            title.clutter_text.set_ellipsize(3);
            textCol.add_child(title);
            if (activeTaskId === task.id) {
                const focusing = new St.Label({text: _('Currently focusing'), style_class: 'fomodoro-focusing'});
                textCol.add_child(focusing);
            }
            const count = new St.Label({text: `🍅 ${task.completed}/${task.estimate}`, style_class: 'fomodoro-caption'});

            const deleteBtn = this._iconButton('user-trash-symbolic', () => {
                this._store.deleteTask(task.id);
                if (activeTaskId === task.id)
                    this._engine.setActiveTask(null);
                this._refreshTasks();
            }, _('Delete task'));

            row.connect('button-press-event', () => {
                this._engine.setActiveTask(activeTaskId === task.id ? null : task);
                this._refreshTasks();
                return Clutter.EVENT_STOP;
            });

            row.add_child(doneBtn);
            row.add_child(textCol);
            row.add_child(count);
            row.add_child(deleteBtn);
            this._taskList.add_child(row);
        }

        if (tasks.length === 0 && !this._adding) {
            const empty = new St.Label({
                text: `${_('No tasks yet')}\n${_('Add a task to start tracking your focus.')}`,
                style_class: 'fomodoro-empty',
            });
            this._taskList.add_child(empty);
        }
    }

    // ---------------- Notes ----------------
    _buildNotesView() {
        const view = new St.BoxLayout({vertical: true, visible: false, style_class: 'fomodoro-view'});

        this._noteText = new Clutter.Text({
            editable: true,
            single_line: false,
            reactive: true,
            text: this._store.getNotes(),
            style_class: 'fomodoro-note-editor',
            x_expand: true,
            y_expand: true,
        });
        this._noteText.set_width_request(336);
        this._noteText.set_height_request(320);
        this._noteText.connect('button-press-event', () => {
            this._noteText.grab_key_focus();
            return Clutter.EVENT_STOP;
        });
        this._noteText.connect('notify::text', () => this._scheduleNoteSave());

        this._noteStatus = new St.Label({text: _('Autosaved'), style_class: 'fomodoro-caption'});
        const statusRow = new St.BoxLayout({vertical: false, x_align: Clutter.ActorAlign.END});
        statusRow.add_child(this._noteStatus);

        view.add_child(this._noteText, {y_expand: true, y_fill: true});
        view.add_child(statusRow);
        return view;
    }

    _scheduleNoteSave() {
        if (this._noteSaveId)
            GLib.source_remove(this._noteSaveId);
        this._noteSaveId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            this._noteSaveId = 0;
            this._store.setNotes(this._noteText.get_text() ?? '');
            this._noteStatus.set_text(_('Autosaved'));
            return GLib.SOURCE_REMOVE;
        });
    }

    // ---------------- Stats ----------------
    _buildStatsView() {
        const view = new St.BoxLayout({vertical: true, visible: false, style_class: 'fomodoro-view'});
        const scroll = new St.ScrollView({style_class: 'fomodoro-scroll'});
        const body = new St.BoxLayout({vertical: true, style_class: 'fomodoro-stats-body'});

        this._todayLabels = this._statRow([
            {title: _('Sessions'), key: 'sessions'},
            {title: _('Focus min'), key: 'focusMinutes'},
            {title: _('Break min'), key: 'breakMinutes'},
            {title: _('Tasks done'), key: 'tasksDone'},
        ]);
        body.add_child(new St.Label({text: _('Today'), style_class: 'fomodoro-section-title'}));
        body.add_child(this._todayLabels);

        this._goalLabel = new St.Label({text: '', style_class: 'fomodoro-caption'});
        this._goalBar = new St.DrawingArea({width: 336, height: 8});
        this._goalBar.connect('repaint', () => this._drawGoalBar(this._goalBar));
        body.add_child(this._goalBar);
        body.add_child(this._goalLabel);

        this._streakLabel = new St.Label({text: '', style_class: 'fomodoro-big-number'});
        body.add_child(new St.Label({text: _('Streak'), style_class: 'fomodoro-section-title'}));
        body.add_child(this._streakLabel);

        this._allTimeLabel = new St.Label({text: '', style_class: 'fomodoro-big-number'});
        body.add_child(new St.Label({text: _('All-time'), style_class: 'fomodoro-section-title'}));
        body.add_child(this._allTimeLabel);

        body.add_child(new St.Label({text: _('Last 7 days'), style_class: 'fomodoro-section-title'}));
        this._weekLabels = this._statRow([
            {title: _('Total'), key: 'total'},
            {title: _('Avg per day'), key: 'avg'},
        ]);
        body.add_child(this._weekLabels);
        this._chart = new St.DrawingArea({width: 336, height: 120});
        this._chart.connect('repaint', () => this._drawChart(this._chart));
        body.add_child(this._chart);

        this._historyBox = new St.BoxLayout({vertical: true});
        body.add_child(new St.Label({text: _('Session history — today'), style_class: 'fomodoro-section-title'}));
        body.add_child(this._historyBox);

        scroll.add_child(body);
        view.add_child(scroll, {y_expand: true, y_fill: true});
        return view;
    }

    _statRow(defs) {
        const row = new St.BoxLayout({vertical: false});
        this._statValues = this._statValues ?? {};
        for (const def of defs) {
            const box = new St.BoxLayout({vertical: true, style_class: 'fomodoro-stat-box', x_expand: true});
            const value = new St.Label({text: '0', style_class: 'fomodoro-stat-value'});
            const title = new St.Label({text: def.title, style_class: 'fomodoro-stat-title'});
            box.add_child(value);
            box.add_child(title);
            row.add_child(box);
            this._statValues[def.key] = value;
        }
        return row;
    }

    _drawGoalBar(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        if (width <= 0 || height <= 0) {
            cr.$dispose();
            return;
        }
        const stats = this._store.statsToday();
        const goal = Math.max(1, this._store.dailyGoal);
        const frac = Math.min(1, stats.sessions / goal);
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);
        cr.setSourceRGBA(0.5, 0.5, 0.5, 0.18);
        cr.rectangle(0, 0, width, height);
        cr.fill();
        cr.setSourceRGBA(ACCENT.r, ACCENT.g, ACCENT.b, 0.9);
        cr.rectangle(0, 0, width * frac, height);
        cr.fill();
        cr.$dispose();
    }

    _drawChart(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        if (width <= 0 || height <= 0) {
            cr.$dispose();
            return;
        }
        const days = this._store.last7Days();
        const max = Math.max(1, ...days.map(d => d.minutes));
        const pad = 4;
        const gap = 6;
        const barWidth = Math.max(8, (width - pad * 2 - gap * (days.length - 1)) / days.length);

        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);

        days.forEach((day, i) => {
            const x = pad + i * (barWidth + gap);
            const barHeight = Math.max(2, (day.minutes / max) * (height - 14));
            const y = height - barHeight;
            cr.setSourceRGBA(ACCENT.r, ACCENT.g, ACCENT.b, 0.85);
            cr.rectangle(x, y, barWidth, barHeight);
            cr.fill();
            cr.setSourceRGBA(0.5, 0.5, 0.5, 0.8);
            cr.setFontSize(9);
            cr.moveTo(x, height - 2);
            cr.showText(day.label);
        });
        cr.$dispose();
    }

    _refreshStats() {
        if (!this._statValues)
            return;
        const stats = this._store.statsToday();
        const fmtMin = (m) => m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
        const last7 = this._store.last7Days();
        const weekTotal = last7.reduce((acc, d) => acc + d.minutes, 0);
        const avg = Math.round(weekTotal / 7);

        this._statValues.sessions.set_text(String(stats.sessions));
        this._statValues.focusMinutes.set_text(String(stats.focusMinutes));
        this._statValues.breakMinutes.set_text(String(stats.breakMinutes));
        this._statValues.tasksDone.set_text(String(stats.tasksDone));
        this._statValues.total.set_text(fmtMin(weekTotal));
        this._statValues.avg.set_text(`${avg} min`);

        const allTime = this._store.allTimeSeconds();
        this._streakLabel.set_text(`🔥 ${this._store.streak()} days`);
        this._allTimeLabel.set_text(`${Math.floor(allTime / 3600)}h ${Math.round(allTime % 3600 / 60)}m focused`);
        this._goalLabel.set_text(`Daily goal: ${stats.sessions} / ${this._store.dailyGoal} sessions`);
        this._goalBar.queue_repaint();
        this._chart.queue_repaint();

        this._historyBox.destroy_all_children();
        const today = this._store.todaySessions();
        if (today.length === 0) {
            this._historyBox.add_child(new St.Label({text: _('No sessions yet today'), style_class: 'fomodoro-caption'}));
        } else {
            const fmt = (iso) => {
                const d = new Date(iso);
                return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            };
            for (const session of today.slice(0, 20)) {
                const row = new St.BoxLayout({vertical: false, style_class: 'fomodoro-history-row'});
                const kindLabel = session.kind === FOCUS ? '●' : '○';
                const kindColor = session.kind === FOCUS ? _('Focus') : _('Break');
                const time = new St.Label({text: `${fmt(session.start)}  ${kindLabel}`, style_class: 'fomodoro-caption'});
                const title = new St.Label({text: session.taskTitle ?? '—', style_class: 'fomodoro-caption', x_expand: true});
                title.clutter_text.set_ellipsize(3);
                const dur = new St.Label({text: `${Math.round(session.durationSeconds / 60)} min`, style_class: 'fomodoro-caption'});
                row.add_child(time);
                row.add_child(title);
                row.add_child(dur);
                this._historyBox.add_child(row);
                void kindColor;
            }
        }
    }

    // ---------------- Settings ----------------
    _buildSettingsView() {
        const view = new St.BoxLayout({vertical: true, visible: false, style_class: 'fomodoro-view'});
        const scroll = new St.ScrollView({style_class: 'fomodoro-scroll'});
        const body = new St.BoxLayout({vertical: true, style_class: 'fomodoro-stats-body'});

        body.add_child(new St.Label({text: _('Preset'), style_class: 'fomodoro-section-title'}));
        this._presetBox = new St.BoxLayout({vertical: false});
        for (const p of PRESET_OPTIONS) {
            const btn = new St.Button({label: p.label, reactive: true, can_focus: true, style_class: 'fomodoro-preset'});
            btn.connect('clicked', () => {
                if (p.id !== 'custom')
                    this._store.applyPreset(p.id);
                this.refresh();
            });
            this._presetBox.add_child(btn);
        }
        body.add_child(this._presetBox);

        body.add_child(new St.Label({text: _('Durations (minutes)'), style_class: 'fomodoro-section-title'}));
        this._durationRows = {};
        const durDefs = [
            {key: 'focus', label: _('Focus')},
            {key: 'shortBreak', label: _('Short break')},
            {key: 'longBreak', label: _('Long break')},
            {key: 'interval', label: _('Long break every (sessions)')},
        ];
        for (const def of durDefs) {
            const row = new St.BoxLayout({vertical: false});
            const lbl = new St.Label({text: def.label, style_class: 'fomodoro-caption', x_expand: true});
            const val = new St.Label({text: '', style_class: 'fomodoro-caption'});
            const minus = this._textButton('−', () => this._stepDuration(def.key, -1));
            const plus = this._textButton('＋', () => this._stepDuration(def.key, 1));
            row.add_child(lbl);
            row.add_child(minus);
            row.add_child(val);
            row.add_child(plus);
            body.add_child(row);
            this._durationRows[def.key] = {label: val};
        }

        body.add_child(new St.Label({text: _('Daily goal'), style_class: 'fomodoro-section-title'}));
        this._goalRow = this._stepRow(
            () => this._store.dailyGoal,
            (delta) => this._store.dailyGoal = Math.min(24, Math.max(1, this._store.dailyGoal + delta)),
            () => this.refresh());

        body.add_child(new St.Label({text: _('Sound'), style_class: 'fomodoro-section-title'}));
        this._soundBox = new St.BoxLayout({vertical: false});
        this._soundBtn = this._textButton('', () => this._cycleSound());
        const previewBtn = this._textButton(_('Preview'), () => this._soundPlayer.play(this._store.soundChoice));
        this._soundBox.add_child(this._soundBtn);
        this._soundBox.add_child(previewBtn);
        body.add_child(this._soundBox);
        this._customSoundEntry = new St.Entry({hint_text: _('Custom sound path…'), can_focus: true, style_class: 'fomodoro-entry'});
        const useCustomBtn = this._textButton(_('Use'), () => {
            const path = this._customSoundEntry.get_text().trim();
            if (path) {
                this._store.soundChoice = `custom:${path}`;
                this.refresh();
            }
        });
        body.add_child(this._customSoundEntry);
        body.add_child(useCustomBtn);

        body.add_child(new St.Label({text: _('Behavior'), style_class: 'fomodoro-section-title'}));
        this._toggles = {};
        const toggleDefs = [
            {key: 'autostart', label: _('Auto-start next session')},
            {key: 'countdown', label: _('Show countdown in panel')},
            {key: 'autoOpen', label: _('Auto-open popup when a session ends')},
            {key: 'singleBar', label: _('Combined cycle progress')},
        ];
        for (const def of toggleDefs) {
            const row = new St.BoxLayout({vertical: false});
            const lbl = new St.Label({text: def.label, style_class: 'fomodoro-caption', x_expand: true});
            const sw = new St.Switch({state: false, reactive: true, can_focus: true});
            sw.connect('notify::state', () => {
                this._setToggle(def.key, sw.get_state());
            });
            row.add_child(lbl);
            row.add_child(sw);
            body.add_child(row);
            this._toggles[def.key] = sw;
        }

        body.add_child(new St.Label({text: _('About'), style_class: 'fomodoro-section-title'}));
        this._aboutLabel = new St.Label({text: '', style_class: 'fomodoro-caption'});
        body.add_child(this._aboutLabel);
        this._updateBtn = this._textButton(_('Check for updates'), () => this.refresh());
        body.add_child(this._updateBtn);
        this._updateResult = new St.Label({text: '', style_class: 'fomodoro-caption'});
        body.add_child(this._updateResult);

        scroll.add_child(body);
        view.add_child(scroll, {y_expand: true, y_fill: true});
        return view;
    }

    _stepRow(getValue, setDelta, onChange) {
        const row = new St.BoxLayout({vertical: false});
        const val = new St.Label({text: '', style_class: 'fomodoro-caption'});
        const minus = this._textButton('−', () => { setDelta(-1); onChange(); });
        const plus = this._textButton('＋', () => { setDelta(1); onChange(); });
        row.add_child(val, {x_expand: true});
        row.add_child(minus);
        row.add_child(plus);
        this._goalValueLabel = val;
        return row;
    }

    _stepDuration(key, delta) {
        const current = key === 'focus' ? this._store.focusDuration
            : key === 'shortBreak' ? this._store.shortBreakDuration
            : key === 'longBreak' ? this._store.longBreakDuration
            : this._store.longBreakInterval;
        const next = key === 'interval'
            ? Math.min(10, Math.max(1, current + delta))
            : Math.min(120, Math.max(1, current + delta));
        if (key === 'focus' || key === 'shortBreak' || key === 'longBreak')
            this._store.setDuration(key === 'focus' ? FOCUS : key === 'shortBreak' ? SESSION_TYPE.SHORT_BREAK : SESSION_TYPE.LONG_BREAK, next);
        else
            this._store.settings.set_int('long-break-interval', next);
        this.refresh();
    }

    _cycleSound() {
        const current = this._store.soundChoice;
        const ids = SOUND_OPTIONS.map(o => o.id);
        const idx = ids.indexOf(current);
        const next = ids[(idx + 1) % ids.length];
        this._store.soundChoice = next;
        this.refresh();
    }

    _setToggle(key, value) {
        switch (key) {
        case 'autostart': this._store.settings.set_boolean('autostart-next-session', value); break;
        case 'countdown': this._store.settings.set_boolean('show-countdown', value); break;
        case 'autoOpen': this._store.settings.set_boolean('auto-open-on-completion', value); break;
        case 'singleBar': this._store.settings.set_boolean('single-progress-bar', value); break;
        }
    }

    _refreshSettingsState() {
        if (!this._durationRows || !this._toggles)
            return;
        this._durationRows.focus.label.set_text(`${this._store.focusDuration} min`);
        this._durationRows.shortBreak.label.set_text(`${this._store.shortBreakDuration} min`);
        this._durationRows.longBreak.label.set_text(`${this._store.longBreakDuration} min`);
        this._durationRows.interval.label.set_text(`${this._store.longBreakInterval}`);

        if (this._goalValueLabel)
            this._goalValueLabel.set_text(`${this._store.dailyGoal} sessions`);

        const currentPreset = this._store.currentPreset();
        const presetChildren = this._presetBox.get_children();
        presetChildren.forEach((btn, i) => {
            const id = PRESET_OPTIONS[i].id;
            btn.style_class = id === currentPreset ? 'fomodoro-preset-active' : 'fomodoro-preset';
        });

        const choice = this._store.soundChoice;
        const opt = SOUND_OPTIONS.find(o => o.id === choice);
        this._soundBtn.set_label(opt ? opt.label : (_('Custom') + '…'));

        this._toggles.autostart.set_state(this._store.autostartNext);
        this._toggles.countdown.set_state(this._store.showCountdown);
        this._toggles.autoOpen.set_state(this._store.autoOpenOnCompletion);
        this._toggles.singleBar.set_state(this._store.singleProgressBar);
    }

    setAbout(versionText, updateText) {
        if (this._aboutLabel)
            this._aboutLabel.set_text(versionText);
        if (this._updateResult)
            this._updateResult.set_text(updateText ?? '');
    }
}
