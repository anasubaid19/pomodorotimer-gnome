'use strict';

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cairo from 'gi://cairo';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {SESSION_TYPE, KIND_LABEL} from './stores.js';

const FOCUS = SESSION_TYPE.FOCUS;

const ACCENT = {r: 0.94, g: 0.36, b: 0.36};
const BREAK_COLOR = {r: 0.30, g: 0.78, b: 0.45};

const SOUND_OPTIONS = [
    {id: 'none'},
    {id: 'bundled'},
    {id: 'freedesktop:complete'},
    {id: 'freedesktop:bell'},
    {id: 'freedesktop:message'},
    {id: 'freedesktop:dialog-information'},
    {id: 'freedesktop:message-new-instant'},
];

const SOUND_LABELS = {
    'none': () => _('None'),
    'bundled': () => _('Bundled'),
    'freedesktop:complete': () => _('Complete'),
    'freedesktop:bell': () => _('Bell'),
    'freedesktop:message': () => _('Message'),
    'freedesktop:dialog-information': () => _('Information'),
    'freedesktop:message-new-instant': () => _('Instant message'),
};

const PRESET_OPTIONS = [
    {id: 'classic'},
    {id: 'deep-work'},
    {id: 'sprint'},
    {id: 'custom'},
];

const PRESET_LABELS = {
    'classic': () => _('Classic — 25/5'),
    'deep-work': () => _('Deep Work — 50/10'),
    'sprint': () => _('Sprint — 15/3'),
    'custom': () => _('Custom'),
};

export const FomoDoroPopup = GObject.registerClass(
class FomoDoroPopup extends St.BoxLayout {
    constructor(engine, store, soundPlayer, onCheckUpdates = null, onOpenReleases = null) {
        super({vertical: true, style_class: 'fomodoro-popup'});
        this._engine = engine;
        this._store = store;
        this._soundPlayer = soundPlayer;
        this._onCheckUpdates = onCheckUpdates;
        this._onOpenReleases = onOpenReleases;
        this._tab = 'tasks';
        this._adding = false;
        this._noteSaveId = 0;
        this._noteFocusId = 0;
        this._destroying = false;
        this._statsSignature = '';
        this._statValues = {};
        this.set_width(360);
        this.set_height(620);

        this._buildHeader();
        this._buildTabs();
        this._buildContent();
        this.refresh();
    }

    destroy() {
        this._destroying = true;
        if (this._noteFocusId) {
            GLib.source_remove(this._noteFocusId);
            this._noteFocusId = 0;
        }
        if (this._noteSaveId) {
            GLib.source_remove(this._noteSaveId);
            this._noteSaveId = 0;
            this._store.setNotes(this._noteText.get_text());
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

        this._expandedHeader = new St.BoxLayout({
            vertical: true,
            style_class: 'fomodoro-expanded-header',
        });
        const ringStack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            width: 120,
            height: 120,
            x_align: Clutter.ActorAlign.CENTER,
        });
        ringStack.add_child(this._buildRing());

        const ringText = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._timeLabel = new St.Label({
            text: '25:00',
            style_class: 'fomodoro-time',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._phaseLabel = new St.Label({
            text: _('Focus'),
            style_class: 'fomodoro-phase',
            x_align: Clutter.ActorAlign.CENTER,
        });
        ringText.add_child(this._timeLabel);
        ringText.add_child(this._phaseLabel);
        ringStack.add_child(ringText);
        this._expandedHeader.add_child(ringStack);

        this._dotsLabel = new St.Label({
            text: '● ● ○ ○  ·  0 of 4',
            style_class: 'fomodoro-dots',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._expandedHeader.add_child(this._dotsLabel);

        this._activeTaskLabel = new St.Label({
            text: _('No active task'),
            style_class: 'fomodoro-active-task',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._expandedHeader.add_child(this._activeTaskLabel);

        // Controls
        const controls = new St.BoxLayout({vertical: false, x_align: Clutter.ActorAlign.CENTER, style_class: 'fomodoro-controls'});
        this._playBtn = this._iconButton('media-playback-start-symbolic', () => this._engine.togglePause(), _('Start focus'));
        const skipBtn = this._iconButton('media-skip-forward-symbolic', () => this._engine.skip(), _('Skip to next session'));
        const resetBtn = this._iconButton('view-refresh-symbolic', () => this._engine.reset(), _('Reset timer'));
        controls.add_child(this._playBtn);
        controls.add_child(skipBtn);
        controls.add_child(resetBtn);
        this._expandedHeader.add_child(controls);
        header.add_child(this._expandedHeader);

        this._compactHeader = new St.BoxLayout({
            vertical: false,
            visible: false,
            style_class: 'fomodoro-compact-header',
        });
        this._compactDot = new St.Label({
            text: '●',
            style_class: 'fomodoro-compact-dot-focus',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._compactPhaseLabel = new St.Label({
            text: _('Focus'),
            style_class: 'fomodoro-compact-phase',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._compactTimeLabel = new St.Label({
            text: '25:00',
            style_class: 'fomodoro-compact-time',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._compactPlayBtn = this._iconButton(
            'media-playback-start-symbolic',
            () => this._engine.togglePause(),
            _('Start focus'));
        this._compactHeader.add_child(this._compactDot);
        this._compactHeader.add_child(this._compactPhaseLabel);
        this._compactHeader.add_child(this._compactTimeLabel);
        this._compactHeader.add_child(this._compactPlayBtn);
        header.add_child(this._compactHeader);

        // Completion banner
        this._bannerBox = new St.BoxLayout({vertical: true, style_class: 'fomodoro-banner', visible: false});
        this._bannerTitle = new St.Label({text: _('Focus complete 🎉'), style_class: 'fomodoro-banner-title'});
        const bannerRow = new St.BoxLayout({vertical: false, x_expand: true});
        this._bannerTask = new St.Label({
            style_class: 'fomodoro-caption',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._startBreakBtn = this._textButton(_('Start Break'), () => {
            this._engine.startBreak(SESSION_TYPE.SHORT_BREAK);
            this._engine.dismissCompletion();
        });
        const doneBtn = this._textButton(_('Done'), () => this._engine.dismissCompletion());
        bannerRow.add_child(this._bannerTask);
        bannerRow.add_child(this._startBreakBtn);
        bannerRow.add_child(doneBtn);
        this._bannerBox.add_child(this._bannerTitle);
        this._bannerBox.add_child(bannerRow);
        header.add_child(this._bannerBox);

        this.add_child(header);
    }

    _buildRing() {
        this._ring = new St.DrawingArea({
            width: 120,
            height: 120,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
            style_class: 'fomodoro-ring',
        });
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
        const lineWidth = 8;
        const radius = Math.max(0, (size - lineWidth) / 2 - 4);
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

        if (this._engine.kind !== null) {
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
        const timeText = this._engine.timeString();
        this._timeLabel.set_text(timeText);
        this._compactTimeLabel.set_text(timeText);
        const kind = this._engine.kind;
        const phaseText = this._engine.phase === 'idle'
            ? (this._engine.justCompleted ? _('Focus complete 🎉') : _('Focus'))
            : KIND_LABEL[kind];
        this._phaseLabel.set_text(phaseText);
        this._compactPhaseLabel.set_text(phaseText);
        this._compactDot.style_class = kind && kind !== FOCUS
            ? 'fomodoro-compact-dot-break'
            : 'fomodoro-compact-dot-focus';

        const dots = this._engine.cycleDots;
        const interval = this._store.longBreakInterval;
        let dotsText = '';
        for (let i = 0; i < interval; i++)
            dotsText += i < dots ? '● ' : '○ ';
        dotsText += `  ${dots} of ${interval}`;
        this._dotsLabel.set_text(dotsText);

        const task = this._engine.activeTask;
        this._activeTaskLabel.set_text(task ? `▶ ${task.title}` : _('No active task'));

        const isRunning = this._engine.phase === 'running';
        const playIcon = isRunning ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        const playLabel = isRunning ? _('Pause') : _('Start focus');
        this._playBtn.get_child().set_icon_name(playIcon);
        this._playBtn.set_accessible_name(playLabel);
        this._compactPlayBtn.get_child().set_icon_name(playIcon);
        this._compactPlayBtn.set_accessible_name(playLabel);

        const completed = this._engine.justCompleted;
        this._bannerBox.visible = completed !== null;
        this._startBreakBtn.visible = this._engine.kind === null;
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
            const btn = new St.Button({
                label: def.label,
                reactive: true,
                can_focus: true,
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
            });
            btn.connect('clicked', () => this._switchTab(def.id));
            this._tabButtons[def.id] = btn;
            tabs.add_child(btn);
        }
        this.add_child(tabs);
    }

    _switchTab(id) {
        this._tab = id;
        this._expandedHeader.visible = id === 'tasks';
        this._compactHeader.visible = id !== 'tasks';
        for (const tabId of Object.keys(this._tabButtons)) {
            const active = tabId === id;
            this._tabButtons[tabId].style_class = active ? 'fomodoro-tab-active' : 'fomodoro-tab';
            this._tabButtons[tabId].set_accessible_name(tabId === 'tasks' ? _('Tasks tab') :
                tabId === 'notes' ? _('Notes tab') : tabId === 'stats' ? _('Stats tab') : _('Settings tab'));
        }
        for (const key of Object.keys(this._views))
            this._views[key].visible = key === id;
        this.refresh();
        if (id === 'notes')
            this._focusNoteEditor();
    }

    _focusNoteEditor() {
        if (this._noteFocusId)
            GLib.source_remove(this._noteFocusId);
        this._noteFocusId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._noteFocusId = 0;
            if (!this._destroying && this._tab === 'notes')
                this._noteText.clutter_text.grab_key_focus();
            return GLib.SOURCE_REMOVE;
        });
    }

    // ================= Content =================
    _buildContent() {
        this._views = {};
        this._views.tasks = this._buildTasksView();
        this._views.notes = this._buildNotesView();
        this._views.stats = this._buildStatsView();
        this._views.settings = this._buildSettingsView();

        const content = new St.BoxLayout({
            vertical: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });
        for (const key of Object.keys(this._views))
            content.add_child(this._views[key]);
        this.add_child(content);
        this._switchTab('tasks');
    }

    // ---------------- Tasks ----------------
    _buildTasksView() {
        const view = new St.BoxLayout({
            vertical: true,
            visible: true,
            style_class: 'fomodoro-view',
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });

        this._addButton = new St.Button({
            label: _('＋ Add Task'),
            style_class: 'fomodoro-add-button',
            reactive: true,
            can_focus: true,
            x_align: Clutter.ActorAlign.START,
        });
        this._addButton.connect('clicked', () => this._beginAdding());
        view.add_child(this._addButton);

        this._addForm = new St.BoxLayout({
            vertical: true,
            visible: false,
            style_class: 'fomodoro-add-form',
            x_expand: true,
        });
        this._taskEntry = new St.Entry({
            hint_text: _('Task name'),
            can_focus: true,
            style_class: 'fomodoro-entry',
            x_expand: true,
        });
        this._taskEntry.clutter_text.connect('activate', () => this._commitTask());
        const estimateRow = new St.BoxLayout({
            vertical: false,
            style_class: 'fomodoro-form-row',
            x_expand: true,
        });
        const estimateTitle = new St.Label({
            text: _('Sessions'),
            style_class: 'fomodoro-caption',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._estimateLabel = new St.Label({
            text: '1',
            style_class: 'fomodoro-step-value',
        });
        const estimateControls = this._stepperControls(
            this._estimateLabel,
            () => this._adjustEstimate(-1),
            () => this._adjustEstimate(1));

        const actionRow = new St.BoxLayout({
            vertical: false,
            style_class: 'fomodoro-form-row',
            x_align: Clutter.ActorAlign.END,
        });
        const addBtn = this._textButton(_('Add'), () => this._commitTask());
        const cancelBtn = this._textButton(_('Cancel'), () => this._cancelAdding());
        this._addTaskBtn = addBtn;
        addBtn.style_class = 'fomodoro-primary-button';
        cancelBtn.style_class = 'fomodoro-secondary-button';
        this._taskEntry.clutter_text.connect('text-changed', () => {
            this._setButtonEnabled(this._addTaskBtn, this._taskEntry.get_text().trim().length > 0);
        });
        this._setButtonEnabled(this._addTaskBtn, false);
        estimateRow.add_child(estimateTitle);
        estimateRow.add_child(estimateControls);
        actionRow.add_child(cancelBtn);
        actionRow.add_child(addBtn);
        this._addForm.add_child(this._taskEntry);
        this._addForm.add_child(estimateRow);
        this._addForm.add_child(actionRow);
        view.add_child(this._addForm);

        this._taskList = new St.BoxLayout({
            vertical: true,
            style_class: 'fomodoro-task-list',
            x_expand: true,
        });
        const taskScroll = new St.ScrollView({
            style_class: 'fomodoro-task-scroll',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
            clip_to_allocation: true,
        });
        taskScroll.add_child(this._taskList);
        view.add_child(taskScroll);
        return view;
    }

    _beginAdding() {
        this._adding = true;
        this._estimate = 1;
        this._taskEntry.set_text('');
        this._addButton.visible = false;
        this._addForm.visible = true;
        this._estimateLabel.set_text('1');
        this._taskEntry.clutter_text.grab_key_focus();
    }

    _cancelAdding() {
        this._adding = false;
        this._addButton.visible = true;
        this._addForm.visible = false;
    }

    _adjustEstimate(delta) {
        this._estimate = Math.min(20, Math.max(1, this._estimate + delta));
        this._estimateLabel.set_text(String(this._estimate));
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
        const tasks = this._store.getTasks();
        const activeTaskId = this._engine.activeTask ? this._engine.activeTask.id : null;
        const signature = JSON.stringify({tasks, activeTaskId});
        if (signature === this._tasksSignature)
            return;
        this._tasksSignature = signature;
        this._taskList.destroy_all_children();

        for (const task of tasks) {
            const row = new St.BoxLayout({
                vertical: false,
                style_class: 'fomodoro-task-row',
                x_expand: true,
            });
            if (activeTaskId === task.id)
                row.add_style_class_name('fomodoro-task-row-active');

            const doneBtn = this._iconButton(
                task.done ? 'checkbox-checked-symbolic' : 'checkbox-symbolic',
                () => {
                    const done = !task.done;
                    this._store.updateTask(task.id, {
                        done,
                        completedAt: done ? new Date().toISOString() : null,
                    });
                    if (activeTaskId === task.id) {
                        this._engine.activeTask.done = done;
                        this._engine.activeTask.completedAt = done ? new Date().toISOString() : null;
                    }
                    this._refreshTasks();
                },
                task.done ? _('Mark not done') : _('Mark done'));

            const textCol = new St.BoxLayout({vertical: true, x_expand: true});
            const title = new St.Label({
                text: task.title,
                style_class: task.done ? 'fomodoro-task-title-done' : 'fomodoro-task-title',
                x_expand: true,
            });
            title.clutter_text.set_ellipsize(3);
            textCol.add_child(title);
            if (activeTaskId === task.id) {
                const focusing = new St.Label({text: _('Currently focusing'), style_class: 'fomodoro-focusing'});
                textCol.add_child(focusing);
            }
            const count = new St.Label({
                text: `🍅 ${task.completed}/${task.estimate}`,
                style_class: 'fomodoro-caption',
                y_align: Clutter.ActorAlign.CENTER,
            });
            const estimateDown = this._stepButton('−', () => this._adjustTaskEstimate(task, -1));
            const estimateUp = this._stepButton('+', () => this._adjustTaskEstimate(task, 1));
            estimateDown.style_class = 'fomodoro-task-step-button';
            estimateUp.style_class = 'fomodoro-task-step-button';
            estimateDown.set_width(28);
            estimateDown.set_height(28);
            estimateUp.set_width(28);
            estimateUp.set_height(28);
            const estimateControls = new St.BoxLayout({
                vertical: false,
                style_class: 'fomodoro-task-stepper',
            });
            estimateControls.add_child(estimateDown);
            estimateControls.add_child(count);
            estimateControls.add_child(estimateUp);

            const deleteBtn = this._iconButton('user-trash-symbolic', () => {
                this._store.deleteTask(task.id);
                if (activeTaskId === task.id)
                    this._engine.setActiveTask(null);
                this._refreshTasks();
            }, _('Delete task'));

            const taskButton = new St.Button({
                style_class: 'fomodoro-task-main',
                reactive: true,
                can_focus: true,
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
            });
            taskButton.set_accessible_name(
                activeTaskId === task.id
                    ? `${task.title}, ${_('Currently focusing')}`
                    : task.title);
            taskButton.add_child(textCol);
            taskButton.connect('clicked', () => {
                this._engine.setActiveTask(activeTaskId === task.id ? null : task);
                this._refreshTasks();
            });

            row.add_child(doneBtn);
            row.add_child(taskButton);
            row.add_child(estimateControls);
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

    _adjustTaskEstimate(task, delta) {
        const estimate = Math.min(20, Math.max(1, (task.estimate || 1) + delta));
        this._store.updateTask(task.id, {estimate});
        if (this._engine.activeTask?.id === task.id)
            this._engine.activeTask.estimate = estimate;
        this._refreshTasks();
    }

    // ---------------- Notes ----------------
    _buildNotesView() {
        const view = new St.BoxLayout({
            vertical: true,
            visible: false,
            style_class: 'fomodoro-view',
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });

        this._noteEditor = new St.ScrollView({
            style_class: 'fomodoro-note-editor',
            reactive: true,
            can_focus: false,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
            clip_to_allocation: true,
        });
        this._noteEditor.set_height(320);

        this._noteText = new St.Entry({
            text: this._store.getNotes(),
            hint_text: _('Quick note — jot something down…'),
            can_focus: true,
            style_class: 'fomodoro-note-text',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.START,
        });
        this._noteText.set_accessible_name(_('Notes editor'));
        this._noteText.clutter_text.set_single_line_mode(false);
        this._noteText.clutter_text.set_line_wrap(true);
        this._noteText.clutter_text.set_ellipsize(0);

        this._noteEditor.connect('button-press-event', () => {
            this._noteText.clutter_text.grab_key_focus();
            return Clutter.EVENT_PROPAGATE;
        });
        this._noteText.clutter_text.connect('key-focus-in', () => this._noteEditor.add_style_pseudo_class('focus'));
        this._noteText.clutter_text.connect('key-focus-out', () => this._noteEditor.remove_style_pseudo_class('focus'));
        this._noteText.clutter_text.connect('text-changed', () => this._scheduleNoteSave());

        const noteBody = new St.BoxLayout({vertical: true, x_expand: true});
        noteBody.add_child(this._noteText);
        this._noteEditor.add_child(noteBody);

        this._noteStatus = new St.Label({text: _('Autosaved'), style_class: 'fomodoro-caption'});
        const statusRow = new St.BoxLayout({vertical: false, x_align: Clutter.ActorAlign.END});
        statusRow.add_child(this._noteStatus);

        view.add_child(this._noteEditor);
        view.add_child(statusRow);
        return view;
    }

    _scheduleNoteSave() {
        if (this._destroying)
            return;
        if (this._noteSaveId)
            GLib.source_remove(this._noteSaveId);
        this._noteStatus.set_text(_('Saving…'));
        this._noteSaveId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            this._noteSaveId = 0;
            if (this._destroying)
                return GLib.SOURCE_REMOVE;
            this._store.setNotes(this._noteText.get_text());
            this._noteStatus.set_text(_('Autosaved'));
            return GLib.SOURCE_REMOVE;
        });
    }

    // ---------------- Stats ----------------
    _buildStatsView() {
        const view = new St.BoxLayout({
            vertical: true,
            visible: false,
            style_class: 'fomodoro-view',
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });
        this._statsScroll = new St.ScrollView({
            style_class: 'fomodoro-scroll',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            clip_to_allocation: true,
        });
        const body = new St.BoxLayout({
            vertical: true,
            style_class: 'fomodoro-stats-body',
            x_expand: true,
        });
        this._statsEmpty = new St.Label({
            text: `${_('No sessions yet')}\n${_('Start a timer to build your stats.')}`,
            style_class: 'fomodoro-empty',
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const todayGrid = new St.BoxLayout({
            vertical: true,
            style_class: 'fomodoro-stat-grid',
            x_expand: true,
        });
        todayGrid.add_child(this._statRow([
            {title: _('Sessions'), key: 'sessions'},
            {title: _('Focus min'), key: 'focusMinutes'},
        ]));
        todayGrid.add_child(this._statRow([
            {title: _('Break min'), key: 'breakMinutes'},
            {title: _('Tasks done'), key: 'tasksDone'},
        ]));
        body.add_child(new St.Label({text: _('Today'), style_class: 'fomodoro-section-title'}));
        body.add_child(todayGrid);

        this._goalLabel = new St.Label({text: '', style_class: 'fomodoro-caption'});
        this._goalBar = new St.DrawingArea({
            height: 8,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            clip_to_allocation: true,
        });
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
        this._chart = new St.DrawingArea({
            height: 140,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            clip_to_allocation: true,
        });
        this._chart.connect('repaint', () => this._drawChart(this._chart));
        body.add_child(this._chart);

        this._historyBox = new St.BoxLayout({vertical: true, x_expand: true});
        body.add_child(new St.Label({text: _('Session history — today'), style_class: 'fomodoro-section-title'}));
        body.add_child(this._historyBox);

        this._statsScroll.add_child(body);
        view.add_child(this._statsScroll);
        view.add_child(this._statsEmpty);
        return view;
    }

    _statRow(defs) {
        const row = new St.BoxLayout({
            vertical: false,
            style_class: 'fomodoro-stat-row',
            x_expand: true,
        });
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
        const pad = 2;
        const valueHeight = 16;
        const labelHeight = 18;
        const graphTop = valueHeight;
        const graphBottom = height - labelHeight - 4;
        const graphHeight = Math.max(1, graphBottom - graphTop);
        const columnWidth = (width - pad * 2) / days.length;
        const barWidth = Math.max(8, columnWidth * 0.62);

        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);

        cr.setSourceRGBA(0.5, 0.5, 0.5, 0.22);
        cr.setLineWidth(1);
        cr.moveTo(pad, graphBottom + 0.5);
        cr.lineTo(width - pad, graphBottom + 0.5);
        cr.stroke();

        days.forEach((day, i) => {
            const columnX = pad + i * columnWidth;
            const x = columnX + (columnWidth - barWidth) / 2;
            const barHeight = day.minutes > 0
                ? Math.max(2, (day.minutes / max) * graphHeight)
                : 0;
            const y = graphBottom - barHeight;
            if (barHeight > 0) {
                cr.setSourceRGBA(ACCENT.r, ACCENT.g, ACCENT.b, 0.85);
                cr.rectangle(x, y, barWidth, barHeight);
                cr.fill();
            }

            const valueText = `${day.minutes}m`;
            const estimatedValueWidth = valueText.length * 5;
            const valueY = barHeight > 0
                ? Math.max(10, y - 3)
                : graphBottom - 3;
            if (barHeight > 0)
                cr.setSourceRGBA(ACCENT.r, ACCENT.g, ACCENT.b, 0.95);
            else
                cr.setSourceRGBA(0.65, 0.65, 0.65, 0.72);
            cr.setFontSize(9);
            cr.moveTo(columnX + (columnWidth - estimatedValueWidth) / 2, valueY);
            cr.showText(valueText);

            cr.setSourceRGBA(0.5, 0.5, 0.5, 0.8);
            cr.setFontSize(9);
            const estimatedLabelWidth = day.label.length * 5;
            cr.moveTo(columnX + (columnWidth - estimatedLabelWidth) / 2, height - 3);
            cr.showText(day.label);
        });
        cr.$dispose();
    }

    _refreshStats() {
        const sessions = this._store.getSessions();
        const stats = this._store.statsToday();
        const statsSignature = JSON.stringify({
            sessions,
            stats,
            dailyGoal: this._store.dailyGoal,
        });
        if (statsSignature === this._statsSignature)
            return;
        this._statsSignature = statsSignature;

        const hasSessions = sessions.length > 0;
        this._statsScroll.visible = hasSessions;
        this._statsEmpty.visible = !hasSessions;
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
                const row = new St.BoxLayout({
                    vertical: false,
                    style_class: 'fomodoro-history-row',
                    x_expand: true,
                });
                const dot = new St.Label({
                    text: '●',
                    style_class: session.kind === FOCUS
                        ? 'fomodoro-history-dot-focus'
                        : 'fomodoro-history-dot-break',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                const time = new St.Label({text: fmt(session.start), style_class: 'fomodoro-caption'});
                const title = new St.Label({text: session.taskTitle ? session.taskTitle : '—', style_class: 'fomodoro-caption', x_expand: true});
                title.clutter_text.set_ellipsize(3);
                const dur = new St.Label({text: `${Math.round(session.durationSeconds / 60)} min`, style_class: 'fomodoro-caption'});
                row.add_child(dot);
                row.add_child(time);
                row.add_child(title);
                row.add_child(dur);
                this._historyBox.add_child(row);
            }
        }
    }

    // ---------------- Settings ----------------
    _buildSettingsView() {
        const view = new St.BoxLayout({
            vertical: true,
            visible: false,
            style_class: 'fomodoro-view',
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });
        const scroll = new St.ScrollView({
            style_class: 'fomodoro-scroll',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            clip_to_allocation: true,
        });
        const body = new St.BoxLayout({
            vertical: true,
            style_class: 'fomodoro-settings-body',
            x_expand: true,
        });

        const addSection = title => {
            const section = new St.BoxLayout({
                vertical: true,
                style_class: 'fomodoro-settings-section',
                x_expand: true,
            });
            section.add_child(new St.Label({
                text: title,
                style_class: 'fomodoro-settings-title',
            }));
            body.add_child(section);
            return section;
        };

        const presetSection = addSection(_('Preset'));
        this._presetBox = new St.BoxLayout({
            vertical: true,
            style_class: 'fomodoro-preset-grid',
            x_expand: true,
        });
        this._presetButtons = {};
        let presetRow = null;
        PRESET_OPTIONS.forEach((p, index) => {
            if (index % 2 === 0) {
                presetRow = new St.BoxLayout({
                    vertical: false,
                    style_class: 'fomodoro-preset-row',
                    x_expand: true,
                });
                this._presetBox.add_child(presetRow);
            }
            const btn = new St.Button({label: PRESET_LABELS[p.id](), reactive: true, can_focus: true, style_class: 'fomodoro-preset'});
            btn.x_expand = true;
            btn.connect('clicked', () => {
                if (p.id !== 'custom')
                    this._store.applyPreset(p.id);
                this.refresh();
            });
            presetRow.add_child(btn);
            this._presetButtons[p.id] = btn;
        });
        presetSection.add_child(this._presetBox);

        const durationSection = addSection(_('Durations (minutes)'));
        this._durationRows = {};
        const durDefs = [
            {key: 'focus', label: _('Focus')},
            {key: 'shortBreak', label: _('Short break')},
            {key: 'longBreak', label: _('Long break')},
            {key: 'interval', label: _('Long break every (sessions)')},
        ];
        for (const def of durDefs) {
            const row = new St.BoxLayout({
                vertical: false,
                style_class: 'fomodoro-settings-row',
                x_expand: true,
            });
            const lbl = new St.Label({
                text: def.label,
                style_class: 'fomodoro-caption',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            lbl.clutter_text.set_ellipsize(3);
            const val = new St.Label({text: '', style_class: 'fomodoro-step-value'});
            const controls = this._stepperControls(
                val,
                () => this._stepDuration(def.key, -1),
                () => this._stepDuration(def.key, 1));
            row.add_child(lbl);
            row.add_child(controls);
            durationSection.add_child(row);
            this._durationRows[def.key] = {label: val};
        }

        const goalSection = addSection(_('Daily goal'));
        this._goalRow = this._stepRow(
            () => this._store.dailyGoal,
            (delta) => this._store.dailyGoal = Math.min(24, Math.max(1, this._store.dailyGoal + delta)),
            () => this.refresh());
        goalSection.add_child(this._goalRow);

        const soundSection = addSection(_('Sound'));
        this._soundButtons = {};
        const soundOptionsBox = new St.BoxLayout({
            vertical: true,
            style_class: 'fomodoro-sound-options',
            x_expand: true,
        });
        let soundRow = null;
        SOUND_OPTIONS.forEach((option, index) => {
            if (index % 2 === 0) {
                soundRow = new St.BoxLayout({
                    vertical: false,
                    style_class: 'fomodoro-sound-row',
                    x_expand: true,
                });
                soundOptionsBox.add_child(soundRow);
            }
            const button = this._textButton(SOUND_LABELS[option.id](), () => {
                this._store.soundChoice = option.id;
                this._refreshSettingsState();
            });
            button.x_expand = true;
            soundRow.add_child(button);
            this._soundButtons[option.id] = button;
        });
        soundSection.add_child(soundOptionsBox);

        this._soundBox = new St.BoxLayout({
            vertical: false,
            style_class: 'fomodoro-action-row',
            x_expand: true,
        });
        const previewBtn = this._textButton(
            _('Preview selected sound'),
            () => this._soundPlayer.play(this._store.soundChoice));
        this._previewSoundBtn = previewBtn;
        previewBtn.style_class = 'fomodoro-secondary-button';
        this._soundBox.add_child(previewBtn);
        soundSection.add_child(this._soundBox);

        const customSoundRow = new St.BoxLayout({
            vertical: false,
            style_class: 'fomodoro-action-row',
            x_expand: true,
        });
        this._customSoundEntry = new St.Entry({
            text: this._store.soundChoice.startsWith('custom:')
                ? this._store.soundChoice.slice('custom:'.length)
                : '',
            hint_text: _('Custom sound path…'),
            can_focus: true,
            style_class: 'fomodoro-entry',
            x_expand: true,
        });
        const useCustomSound = () => {
            const path = this._customSoundEntry.get_text().trim();
            if (path) {
                this._store.soundChoice = `custom:${path}`;
                this.refresh();
            }
        };
        const useCustomBtn = this._textButton(_('Use'), useCustomSound);
        this._useCustomSoundBtn = useCustomBtn;
        useCustomBtn.style_class = 'fomodoro-primary-button';
        this._customSoundEntry.clutter_text.connect('activate', useCustomSound);
        this._customSoundEntry.clutter_text.connect('text-changed', () => {
            this._setButtonEnabled(
                this._useCustomSoundBtn,
                this._customSoundEntry.get_text().trim().length > 0);
        });
        this._setButtonEnabled(
            this._useCustomSoundBtn,
            this._customSoundEntry.get_text().trim().length > 0);
        customSoundRow.add_child(this._customSoundEntry);
        customSoundRow.add_child(useCustomBtn);
        soundSection.add_child(customSoundRow);

        const behaviorSection = addSection(_('Behavior'));
        this._toggles = {};
        const toggleDefs = [
            {key: 'autostart', label: _('Auto-start next session')},
            {key: 'countdown', label: _('Show countdown in panel')},
            {key: 'autoOpen', label: _('Auto-open popup when a session ends')},
        ];
        for (const def of toggleDefs) {
            const row = new St.BoxLayout({
                vertical: false,
                style_class: 'fomodoro-settings-row',
                x_expand: true,
            });
            const lbl = new St.Label({
                text: def.label,
                style_class: 'fomodoro-caption',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            lbl.clutter_text.set_ellipsize(3);
            const sw = new St.Button({
                label: _('Off'),
                style_class: 'fomodoro-toggle',
                reactive: true,
                can_focus: true,
                toggle_mode: true,
            });
            sw.set_accessible_name(def.label);
            sw.set_width(58);
            sw.set_height(30);
            sw.connect('notify::checked', () => {
                const enabled = sw.get_checked();
                sw.set_label(enabled ? _('On') : _('Off'));
                this._setToggle(def.key, enabled);
            });
            row.add_child(lbl);
            row.add_child(sw);
            behaviorSection.add_child(row);
            this._toggles[def.key] = sw;
        }

        const aboutSection = addSection(_('About'));
        this._aboutLabel = new St.Label({text: '', style_class: 'fomodoro-caption'});
        aboutSection.add_child(this._aboutLabel);
        const updateActions = new St.BoxLayout({
            vertical: false,
            style_class: 'fomodoro-action-row',
            x_expand: true,
        });
        this._updateBtn = this._textButton(_('Check for updates'), () => {
            this._updateResult.set_text(_('Checking for updates…'));
            if (this._onCheckUpdates)
                this._onCheckUpdates();
        });
        this._updateBtn.style_class = 'fomodoro-secondary-button';
        updateActions.add_child(this._updateBtn);
        this._downloadBtn = this._textButton(_('Download'), () => {
            if (this._onOpenReleases)
                this._onOpenReleases();
        });
        this._downloadBtn.style_class = 'fomodoro-primary-button';
        this._downloadBtn.visible = false;
        updateActions.add_child(this._downloadBtn);
        aboutSection.add_child(updateActions);
        this._updateResult = new St.Label({text: '', style_class: 'fomodoro-caption'});
        aboutSection.add_child(this._updateResult);

        scroll.add_child(body);
        view.add_child(scroll);
        return view;
    }

    _stepRow(getValue, setDelta, onChange) {
        const row = new St.BoxLayout({
            vertical: false,
            style_class: 'fomodoro-settings-row',
            x_expand: true,
        });
        const label = new St.Label({
            text: _('Sessions per day'),
            style_class: 'fomodoro-caption',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const val = new St.Label({text: '', style_class: 'fomodoro-step-value'});
        const controls = this._stepperControls(
            val,
            () => { setDelta(-1); onChange(); },
            () => { setDelta(1); onChange(); });
        row.add_child(label);
        row.add_child(controls);
        this._goalValueLabel = val;
        return row;
    }

    _stepperControls(valueLabel, onDecrease, onIncrease) {
        const controls = new St.BoxLayout({
            vertical: false,
            style_class: 'fomodoro-stepper',
            x_align: Clutter.ActorAlign.END,
        });
        valueLabel.set_width(58);
        valueLabel.y_align = Clutter.ActorAlign.CENTER;
        controls.add_child(this._stepButton('−', onDecrease));
        controls.add_child(valueLabel);
        controls.add_child(this._stepButton('+', onIncrease));
        return controls;
    }

    _stepButton(text, onClick) {
        const button = this._textButton(text, onClick);
        button.style_class = 'fomodoro-step-button';
        button.set_width(36);
        button.set_height(30);
        return button;
    }

    _setButtonEnabled(button, enabled) {
        button.reactive = enabled;
        button.can_focus = enabled;
    }

    _stepDuration(key, delta) {
        const current = key === 'focus' ? this._store.focusDuration
            : key === 'shortBreak' ? this._store.shortBreakDuration
            : key === 'longBreak' ? this._store.longBreakDuration
            : this._store.longBreakInterval;
        const next = key === 'interval'
            ? Math.min(12, Math.max(1, current + delta))
            : Math.min(120, Math.max(1, current + delta));
        if (key === 'focus' || key === 'shortBreak' || key === 'longBreak')
            this._store.setDuration(key === 'focus' ? FOCUS : key === 'shortBreak' ? SESSION_TYPE.SHORT_BREAK : SESSION_TYPE.LONG_BREAK, next);
        else
            this._store.settings.set_int('long-break-interval', next);
        this.refresh();
    }

    _setToggle(key, value) {
        switch (key) {
        case 'autostart': this._store.settings.set_boolean('autostart-next-session', value); break;
        case 'countdown': this._store.settings.set_boolean('show-countdown', value); break;
        case 'autoOpen': this._store.settings.set_boolean('auto-open-on-completion', value); break;
        }
    }

    _refreshSettingsState() {
        this._durationRows.focus.label.set_text(`${this._store.focusDuration} min`);
        this._durationRows.shortBreak.label.set_text(`${this._store.shortBreakDuration} min`);
        this._durationRows.longBreak.label.set_text(`${this._store.longBreakDuration} min`);
        this._durationRows.interval.label.set_text(`${this._store.longBreakInterval}`);

        this._goalValueLabel.set_text(String(this._store.dailyGoal));

        const currentPreset = this._store.currentPreset();
        for (const [id, btn] of Object.entries(this._presetButtons))
            btn.style_class = id === currentPreset
                ? 'fomodoro-preset fomodoro-preset-active'
                : 'fomodoro-preset';

        const choice = this._store.soundChoice;
        for (const [id, button] of Object.entries(this._soundButtons))
            button.style_class = id === choice
                ? 'fomodoro-option-button fomodoro-sound-active'
                : 'fomodoro-option-button';
        this._setButtonEnabled(this._previewSoundBtn, choice !== 'none');

        this._setToggleButtonState(this._toggles.autostart, this._store.autostartNext);
        this._setToggleButtonState(this._toggles.countdown, this._store.showCountdown);
        this._setToggleButtonState(this._toggles.autoOpen, this._store.autoOpenOnCompletion);
    }

    _setToggleButtonState(button, enabled) {
        button.set_checked(enabled);
        button.set_label(enabled ? _('On') : _('Off'));
    }

    setAbout(versionText, updateText, updateAvailable = false) {
        this._aboutLabel.set_text(versionText);
        this._updateResult.set_text(updateText);
        this._downloadBtn.visible = updateAvailable;
    }
});
