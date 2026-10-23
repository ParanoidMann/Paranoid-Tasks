import { ItemView, Menu, Notice, Platform, setIcon, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { formatDate, t, TranslationKey } from "./i18n";
import type ParanoidTasksPlugin from "./main";
import type { ColumnConfig, Priority } from "./settings";
import {
	addTask,
	editTask,
	formatTask,
	getItems,
	moveTask,
	parseTask,
	REMOVE_SECTION,
	sameTitle,
	TaskList,
	clearSection,
	daysUntil,
	deleteTask as deleteTaskLine,
	formatDoneTime,
	ParsedTask,
	parseRepeat,
	RepeatRule,
	toFileName,
	toISODate,
} from "./tasks";
import { ensureTaskFile, readTasks, taskFilePath, updateTasks } from "./taskStore";
import { ConfirmModal } from "./ConfirmModal";
import { TaskModal, TaskModalResult } from "./TaskModal";
import {
	checkDetailsName,
	createDetails,
	openDetails,
	renameDetailsFile,
	resolveDetails,
	trashDetails,
} from "./details";

export const VIEW_TYPE_BOARD = "paranoid-tasks-board";

/** How long a finger has to rest on a card to open its menu (mobile), and how far it may move meanwhile. */
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;

/** Human-readable repeat rule, e.g. "Every day at 09:00". */
function repeatLabel(rule: RepeatRule): string {
	const time = rule.time;
	if (!time) return t(`repeat.${rule.kind}`);
	if (rule.kind === "weekly" && rule.weekday) {
		return t("repeat.weeklyAtTime", { weekday: t(`weekdayOn.${rule.weekday}` as TranslationKey), time });
	}
	if (rule.kind === "monthly" && rule.day) return t("repeat.monthlyAtTime", { day: rule.day, time });
	return t("repeat.dailyAtTime", { time });
}

/** How a column of cards is drawn. */
interface ColumnView {
	/** Section in the task file. */
	section: string;
	/** Label in the header (differs from the section only for Remove). */
	title: string;
	collapsible: boolean;
	showCount: boolean;
	canAdd: boolean;
	/** Shows a "Clear" button in the header that calls this. */
	onClear?: () => void;
}

interface DragState {
	section: string;
	index: number;
	text: string;
}

export class BoardView extends ItemView {
	private dragged: DragState | null = null;
	/** Index of the column being dragged, or null. */
	private draggedColumn: number | null = null;
	private dropIndicator: HTMLElement | null = null;
	private renderToken = 0;
	/** Show the Remove section as a column (toggled from the view header; not saved). */
	private showRemoved = false;
	private removedAction: HTMLElement | null = null;
	/** Opens the long-press menu of a card; used by the console helper (see devCardMenu in main.ts). */
	private cardMenus = new WeakMap<HTMLElement, (position: { x: number; y: number }) => void>();

	constructor(leaf: WorkspaceLeaf, private plugin: ParanoidTasksPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_BOARD;
	}

	getDisplayText(): string {
		return this.plugin.boardTitle();
	}

	getIcon(): string {
		return this.plugin.settings.boardIcon;
	}

	async onOpen(): Promise<void> {
		this.removedAction = this.addAction("archive", t("board.showRemoved"), () => {
			this.showRemoved = !this.showRemoved;
			void this.refresh();
		});
		// Main.md content changes redraw the board; any note appearing, disappearing or
		// being renamed may change whether a details link resolves.
		const onMainChange = (file: TAbstractFile) => {
			if (file.path === taskFilePath()) void this.refresh();
		};
		const onNoteChange = (file: TAbstractFile) => {
			if (file instanceof TFile && file.extension === "md") void this.refresh();
		};
		this.registerEvent(this.app.vault.on("modify", onMainChange));
		this.registerEvent(this.app.vault.on("create", onNoteChange));
		this.registerEvent(this.app.vault.on("delete", onNoteChange));
		this.registerEvent(this.app.vault.on("rename", onNoteChange));

		try {
			await ensureTaskFile(this.app, this.plugin.columnNames());
		} catch (e) {
			new Notice(t("notice.error", { message: (e as Error).message }));
		}
		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	async refresh(): Promise<void> {
		const token = ++this.renderToken;
		const list = await readTasks(this.app);
		// A newer refresh started while we were reading; let it win.
		if (token !== this.renderToken) return;
		this.render(list);
	}

	private async mutate(fn: (list: TaskList) => TaskList): Promise<void> {
		try {
			await updateTasks(this.app, this.plugin.columnNames(), fn);
		} catch (e) {
			new Notice(t("notice.error", { message: (e as Error).message }));
		}
	}

	private render(list: TaskList): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("paranoid-board");
		this.dropIndicator = null;

		// Columns come from settings; Remove is a drop zone unless shown as a column.
		this.plugin.settings.columns.forEach((column, index) => {
			// Collapsed state is kept while collapsing is off, so it comes back when re-enabled.
			const items = getItems(list, column.name);
			const columnEl =
				column.collapsible && column.collapsed
					? this.renderCollapsedColumn(root, column, items)
					: this.renderColumn(root, items, {
							section: column.name,
							title: column.name,
							collapsible: column.collapsible,
							showCount: column.showCount,
							canAdd: true,
						});
			this.setupColumnDrag(columnEl, index);
		});

		this.removedAction?.setAttr("aria-label", t(this.showRemoved ? "board.hideRemoved" : "board.showRemoved"));
		this.removedAction?.toggleClass("is-active", this.showRemoved);
		const { removeZone } = this.plugin.settings;
		if (this.showRemoved) {
			const column = this.renderColumn(root, getItems(list, REMOVE_SECTION), {
				section: REMOVE_SECTION,
				title: t("board.removeTitle"),
				collapsible: false,
				showCount: true,
				canAdd: false,
				onClear: () => this.confirmClearRemoved(list),
			});
			column.addClass("paranoid-removed-column");
		} else if (removeZone !== "never") {
			this.renderRemoveZone(root, removeZone === "drag");
		}
	}

	/**
	 * Lets the column be reordered by dragging its header (or the whole strip
	 * when collapsed), unless disabled in settings.
	 */
	private setupColumnDrag(column: HTMLElement, index: number): void {
		if (!this.plugin.settings.columnDrag) return;
		const handle = column.hasClass("is-collapsed")
			? column
			: column.querySelector<HTMLElement>(".paranoid-column-header");
		if (!handle) return;
		handle.draggable = true;
		handle.addClass("paranoid-column-handle");

		handle.addEventListener("dragstart", (e) => {
			this.draggedColumn = index;
			e.dataTransfer?.setData("text/plain", this.plugin.settings.columns[index].name);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
			column.addClass("is-dragging");
		});
		handle.addEventListener("dragend", () => {
			column.removeClass("is-dragging");
			this.endDrag();
		});

		column.addEventListener("dragover", (e) => {
			if (this.draggedColumn === null) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			const before = this.isFirstHalf(column, e);
			this.clearColumnDropMarks();
			column.addClass(before ? "is-drop-before" : "is-drop-after");
		});
		column.addEventListener("dragleave", (e) => {
			if (!column.contains(e.relatedTarget as Node | null)) this.clearColumnDropMarks();
		});
		column.addEventListener("drop", (e) => {
			if (this.draggedColumn === null) return;
			e.preventDefault();
			const from = this.draggedColumn;
			const to = this.isFirstHalf(column, e) ? index : index + 1;
			this.endDrag();
			void this.plugin.moveColumnTo(from, to).catch((err: Error) => new Notice(t("notice.error", { message: err.message })));
		});
	}

	/** Whether the cursor is in the left half of a column, or the top half when columns are stacked (phones). */
	private isFirstHalf(el: HTMLElement, e: DragEvent): boolean {
		const rect = el.getBoundingClientRect();
		return getComputedStyle(this.contentEl).flexDirection === "column"
			? e.clientY < rect.top + rect.height / 2
			: e.clientX < rect.left + rect.width / 2;
	}

	private clearColumnDropMarks(): void {
		this.contentEl
			.querySelectorAll(".is-drop-before, .is-drop-after")
			.forEach((el) => el.removeClasses(["is-drop-before", "is-drop-after"]));
	}

	private renderColumn(root: HTMLElement, items: string[], view: ColumnView): HTMLElement {
		const { section, title } = view;
		const column = root.createDiv({ cls: "paranoid-column" });

		const header = column.createDiv({ cls: "paranoid-column-header" });
		if (view.collapsible) {
			const toggle = header.createDiv({
				cls: "clickable-icon paranoid-collapse-toggle",
				attr: { "aria-label": t("board.collapseColumn") },
			});
			setIcon(toggle, "chevron-down");
			toggle.addEventListener("click", () => void this.plugin.setCollapsed(section, true));
		}
		header.createSpan({ cls: "paranoid-column-title", text: title });
		if (view.showCount) {
			header.createSpan({ cls: "paranoid-column-count", text: String(items.length) });
		}
		if (view.onClear) {
			const onClear = view.onClear;
			const clear = header.createEl("button", { cls: "paranoid-clear", text: t("board.clear") });
			clear.disabled = items.length === 0;
			clear.addEventListener("click", () => onClear());
		}
		if (view.canAdd) {
			const addButton = header.createDiv({
				cls: "clickable-icon paranoid-add",
				attr: { "aria-label": t("board.addTask") },
			});
			setIcon(addButton, "plus");
			addButton.addEventListener("click", () => {
				this.openTaskModal(t("board.newTaskTitle", { column: title }), "", (l, line) => addTask(l, section, line));
			});
		}

		const cardList = column.createDiv({ cls: "paranoid-cards" });
		items.forEach((text, index) => this.renderCard(cardList, section, index, text));

		column.addEventListener("dragover", (e) => {
			if (!this.dragged) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			this.showIndicator(cardList, this.dropIndex(cardList, e.clientY));
		});
		column.addEventListener("dragleave", (e) => {
			if (!column.contains(e.relatedTarget as Node | null)) this.hideIndicator();
		});
		column.addEventListener("drop", (e) => {
			if (!this.dragged) return;
			e.preventDefault();
			const toIndex = this.dropIndex(cardList, e.clientY);
			this.drop(section, toIndex);
		});
		return column;
	}

	/** Narrow vertical strip with the title; click expands, dropping a card appends it to the column. */
	private renderCollapsedColumn(root: HTMLElement, config: ColumnConfig, items: string[]): HTMLElement {
		const section = config.name;
		const column = root.createDiv({
			cls: "paranoid-column is-collapsed",
			attr: { "aria-label": t("board.expandColumn", { name: section }) },
		});
		setIcon(column.createDiv({ cls: "paranoid-collapse-toggle" }), "chevron-right");
		column.createDiv({ cls: "paranoid-column-title", text: section });
		if (config.showCount) {
			column.createDiv({ cls: "paranoid-column-count", text: String(items.length) });
		}
		column.addEventListener("click", () => void this.plugin.setCollapsed(section, false));

		column.addEventListener("dragover", (e) => {
			if (!this.dragged) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			column.addClass("is-drop-target");
		});
		column.addEventListener("dragleave", (e) => {
			if (!column.contains(e.relatedTarget as Node | null)) column.removeClass("is-drop-target");
		});
		column.addEventListener("drop", (e) => {
			if (!this.dragged) return;
			e.preventDefault();
			this.drop(section, Number.MAX_SAFE_INTEGER);
		});
		return column;
	}

	/** `text` is the raw line from Main.md, including the priority tag. */
	private renderCard(cardList: HTMLElement, section: string, index: number, text: string): void {
		const task = parseTask(text);
		const priority = this.findPriority(task.priority);
		const card = cardList.createDiv({ cls: "paranoid-card" });
		// On mobile, cards are moved with the long-press menu instead of dragging.
		card.draggable = !Platform.isMobile;

		if (task.repeat) {
			const checkbox = card.createEl("input", {
				type: "checkbox",
				cls: "task-list-item-checkbox paranoid-card-checkbox",
				attr: { "aria-label": t("board.markDone") },
			});
			checkbox.checked = task.done !== null;
			if (checkbox.checked) card.addClass("is-done");
			checkbox.addEventListener("click", (e) => {
				e.stopPropagation();
				const line = formatTask({ ...task, done: checkbox.checked ? formatDoneTime(new Date()) : null });
				void this.mutate((l) => editTask(l, section, index, text, line));
			});
		}

		if (priority) {
			const symbol = card.createSpan({ cls: "paranoid-priority", text: priority.symbol });
			// The color is user-defined, so it is passed to CSS as a variable.
			symbol.setCssProps({ "--paranoid-priority-color": priority.color });
			symbol.setAttr("aria-label", priority.name);
		} else {
			card.createSpan({
				cls: "paranoid-priority is-unknown",
				text: "?",
				attr: { "aria-label": t("board.unknownPriority", { name: task.priority ?? "" }) },
			});
		}
		const body = card.createDiv({ cls: "paranoid-card-body" });
		body.createDiv({ cls: "paranoid-card-text", text: task.text });
		if (task.deadline && this.plugin.settings.deadlineShow) {
			const overdue = daysUntil(toISODate(new Date()), task.deadline) < 0;
			body.createDiv({
				cls: "paranoid-card-deadline" + (overdue ? " is-overdue" : ""),
				text: t("board.deadline", { date: formatDate(task.deadline) }),
			});
		}
		const rule = task.repeat ? parseRepeat(task.repeat) : null;
		if (rule && this.plugin.settings.repeatShow) {
			const repeat = body.createDiv({ cls: "paranoid-card-repeat" });
			setIcon(repeat.createSpan({ cls: "paranoid-card-repeat-icon" }), "repeat");
			repeat.createSpan({ text: repeatLabel(rule) });
		}

		if (task.details && this.plugin.settings.showDetailsIcon) {
			const details = task.details;
			const missing = !resolveDetails(this.app, details);
			const icon = card.createDiv({
				cls: "clickable-icon paranoid-details-icon" + (missing ? " is-missing" : ""),
				attr: {
					"aria-label": missing ? t("board.detailsMissing", { name: details }) : t("board.openDetails", { name: details }),
				},
			});
			setIcon(icon, "file-text");
			icon.addEventListener("click", (e) => {
				e.stopPropagation();
				if (!missing) void openDetails(this.app, details);
			});
		}

		const edit = () =>
			this.openTaskModal(
				t("board.editTaskTitle"),
				text,
				(l, line) => editTask(l, section, index, text, line),
				() => this.deleteTask(section, index, text),
			);
		let longPressed = false;
		card.addEventListener("click", () => {
			// The tap that ends a long press already opened the menu.
			if (longPressed) {
				longPressed = false;
				return;
			}
			edit();
		});
		this.cardMenus.set(card, (position) => this.showCardMenu(position, section, index, text, edit));
		if (Platform.isMobile) {
			// Reset on every touch: a long press is not always followed by a click.
			card.addEventListener("touchstart", () => (longPressed = false));
			this.onLongPress(card, (x, y) => {
				longPressed = true;
				this.showCardMenu({ x, y }, section, index, text, edit);
			});
		}
		card.addEventListener("dragstart", (e) => {
			this.dragged = { section, index, text };
			e.dataTransfer?.setData("text/plain", text);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
			card.addClass("is-dragging");
			// Changing layout inside dragstart can cancel the drag in Chromium, so reveal the zone a tick later.
			window.setTimeout(() => {
				if (this.dragged) this.contentEl.addClass("is-dragging-card");
			});
		});
		card.addEventListener("dragend", () => {
			card.removeClass("is-dragging");
			this.endDrag();
		});
	}

	/**
	 * Calls `onPress` with the touch position when a finger rests on `el` without moving.
	 * Hand-made because iOS does not fire "contextmenu" on a long press.
	 */
	private onLongPress(el: HTMLElement, onPress: (x: number, y: number) => void): void {
		let timer: number | null = null;
		let start = { x: 0, y: 0 };
		const cancel = () => {
			if (timer !== null) window.clearTimeout(timer);
			timer = null;
		};
		el.addEventListener("touchstart", (e) => {
			if (e.touches.length !== 1) return cancel();
			start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
			cancel();
			timer = window.setTimeout(() => {
				timer = null;
				onPress(start.x, start.y);
			}, LONG_PRESS_MS);
		});
		el.addEventListener("touchmove", (e) => {
			const touch = e.touches[0];
			if (touch && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > LONG_PRESS_SLOP_PX) cancel();
		});
		el.addEventListener("touchend", cancel);
		el.addEventListener("touchcancel", cancel);
		// Android also fires "contextmenu" on a long press; the menu above replaces it.
		el.addEventListener("contextmenu", (e) => e.preventDefault());
	}

	/** Opens the mobile card menu for a card element (or an element inside it), or the n-th card on the board. */
	openCardMenu(target: number | HTMLElement): boolean {
		const card =
			typeof target === "number"
				? this.contentEl.querySelectorAll<HTMLElement>(".paranoid-card")[target]
				: target.closest<HTMLElement>(".paranoid-card");
		const open = card ? this.cardMenus.get(card) : undefined;
		if (!card || !open) return false;
		const rect = card.getBoundingClientRect();
		open({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
		return true;
	}

	/** Card actions for mobile, where dragging is inconvenient: edit, move to another column, remove. */
	private showCardMenu(position: { x: number; y: number }, section: string, index: number, text: string, edit: () => void): void {
		const move = (to: string) => void this.mutate((l) => moveTask(l, section, index, text, to, Number.MAX_SAFE_INTEGER));
		const menu = new Menu();
		menu.addItem((item) => item.setTitle(t("board.menuEdit")).setIcon("pencil").onClick(edit));
		menu.addSeparator();
		for (const column of this.plugin.columnNames()) {
			if (sameTitle(column, section)) continue;
			menu.addItem((item) =>
				item
					.setTitle(t("board.menuMoveTo", { column }))
					.setIcon("arrow-right")
					.onClick(() => move(column)),
			);
		}
		if (!sameTitle(section, REMOVE_SECTION)) {
			menu.addSeparator();
			menu.addItem((item) => item.setTitle(t("board.menuRemove")).setIcon("archive").onClick(() => move(REMOVE_SECTION)));
		}
		menu.showAtPosition(position);
	}

	/** Priority for a tag; no tag means the default one. Returns null for a tag not in settings. */
	private findPriority(name: string | null): Priority | null {
		const priorities = this.plugin.settings.priorities;
		if (name === null) return priorities[0];
		return priorities.find((p) => sameTitle(p.name, name)) ?? null;
	}

	/**
	 * Opens the task modal for a raw line ("" for a new task) and applies
	 * `apply(list, newLine)` on save. The default priority is written without a tag.
	 */
	private openTaskModal(
		title: string,
		raw: string,
		apply: (list: TaskList, line: string) => TaskList,
		remove?: () => Promise<void>,
	): void {
		const task = parseTask(raw);
		const priorities = this.plugin.settings.priorities;
		const detailsFile = task.details ? resolveDetails(this.app, task.details) : null;
		const trashesDetails = detailsFile !== null && !this.plugin.settings.keepDetailsOnDelete;
		new TaskModal(this.app, {
			title,
			initialText: task.text,
			priorities: priorities.map((p) => p.name),
			initialPriority: this.findPriority(task.priority)?.name ?? task.priority ?? priorities[0].name,
			initialDeadline: task.deadline,
			initialRepeat: task.repeat,
			initialDetails: task.details,
			detailsExists: detailsFile !== null,
			detailsFromText: this.plugin.settings.detailsFromText,
			fields: {
				details: this.plugin.settings.dialogDetails,
				priority: this.plugin.settings.dialogPriority,
				deadline: this.plugin.settings.dialogDeadline,
				repeat: this.plugin.settings.dialogRepeat,
			},
			// raw is "" only for a new task; hidden details are never added by default.
			startWithDetails: raw === "" && this.plugin.settings.detailsByDefault && this.plugin.settings.dialogDetails,
			onSubmit: (result, open) => this.saveTask(task, result, open, apply),
			onDelete: remove,
			deleteNote: trashesDetails ? t("modal.deleteTaskDetails", { name: task.details ?? "" }) : undefined,
		}).open();
	}

	/** Asks, then deletes every task in Remove (and their details notes, like single deletion). */
	private confirmClearRemoved(list: TaskList): void {
		const items = getItems(list, REMOVE_SECTION);
		const keep = this.plugin.settings.keepDetailsOnDelete;
		const files = keep
			? []
			: items.flatMap((raw) => {
					const { details } = parseTask(raw);
					const file = details ? resolveDetails(this.app, details) : null;
					return file ? [file] : [];
				});
		const message = t("board.clearMessage", { count: items.length });
		new ConfirmModal(this.app, {
			title: t("board.clearTitle"),
			message: files.length > 0 ? `${message} ${t("board.clearDetails", { count: files.length })}` : message,
			confirmText: t("board.clear"),
			onConfirm: () => {
				void (async () => {
					try {
						await updateTasks(this.app, this.plugin.columnNames(), (l) => clearSection(l, REMOVE_SECTION));
						for (const file of files) await trashDetails(this.app, file);
					} catch (e) {
						new Notice(t("notice.error", { message: (e as Error).message }));
					}
				})();
			},
		}).open();
	}

	/** Deletes the task line, then trashes its details note unless the user keeps them. */
	private async deleteTask(section: string, index: number, raw: string): Promise<void> {
		const { details } = parseTask(raw);
		const file = details ? resolveDetails(this.app, details) : null;
		await updateTasks(this.app, this.plugin.columnNames(), (l) => deleteTaskLine(l, section, index, raw));
		if (file && !this.plugin.settings.keepDetailsOnDelete) await trashDetails(this.app, file);
	}

	/**
	 * Writes the task line and creates/renames/trashes the details note.
	 * Order matters: Main.md is updated before a rename so the plugin's rename
	 * handler finds nothing left to fix; a new note is created before it is linked.
	 */
	private async saveTask(
		old: ParsedTask,
		result: TaskModalResult,
		open: boolean,
		apply: (list: TaskList, line: string) => TaskList,
	): Promise<void> {
		const { priorities, detailsFromText } = this.plugin.settings;
		const oldDetails = old.details;
		// The check mark is kept unless the task stops being recurring.
		const done = result.repeat ? old.done : null;
		const columns = this.plugin.columnNames();
		const priority = sameTitle(result.priority, priorities[0].name) ? null : result.priority;
		const write = (details: string | null) =>
			updateTasks(this.app, columns, (l) => apply(l, formatTask({ priority, deadline: result.deadline, repeat: result.repeat, done, details, text: result.text })));
		// An empty name field means "same as the task text".
		const name = toFileName(detailsFromText || !result.details.name ? result.text : result.details.name);
		const oldFile = oldDetails ? resolveDetails(this.app, oldDetails) : null;
		let details: string | null = null;

		switch (result.details.action) {
			case "none":
				await write(null);
				break;
			case "add":
				await createDetails(this.app, name, columns);
				await write(name);
				details = name;
				break;
			case "keep": {
				// A missing note keeps its link as is; an existing one is renamed if the name changed.
				const rename = oldFile !== null && oldFile.basename !== name;
				if (rename) checkDetailsName(this.app, name, oldFile);
				details = rename ? name : oldDetails;
				await write(details);
				if (rename) await renameDetailsFile(this.app, oldFile, name);
				break;
			}
			case "remove":
				await write(null);
				if (oldFile) await trashDetails(this.app, oldFile);
				break;
		}

		if (open && details) await openDetails(this.app, details);
	}

	/** `dragOnly`: hidden by CSS until a card drag adds "is-dragging-card" to the board. */
	private renderRemoveZone(root: HTMLElement, dragOnly: boolean): void {
		const zone = root.createDiv({ cls: "paranoid-column paranoid-remove-zone" });
		if (dragOnly) zone.addClass("is-drag-only");
		const header = zone.createDiv({ cls: "paranoid-column-header" });
		// Only the label is translated; the section in the file is always REMOVE_SECTION.
		header.createSpan({ cls: "paranoid-column-title", text: t("board.removeTitle") });
		const body = zone.createDiv({ cls: "paranoid-remove-body" });
		setIcon(body.createDiv({ cls: "paranoid-remove-icon" }), "trash-2");
		body.createDiv({ text: t("board.dropToRemove") });

		zone.addEventListener("dragover", (e) => {
			if (!this.dragged) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			zone.addClass("is-drop-target");
		});
		zone.addEventListener("dragleave", (e) => {
			if (!zone.contains(e.relatedTarget as Node | null)) zone.removeClass("is-drop-target");
		});
		zone.addEventListener("drop", (e) => {
			if (!this.dragged) return;
			e.preventDefault();
			zone.removeClass("is-drop-target");
			this.drop(REMOVE_SECTION, Number.MAX_SAFE_INTEGER);
		});
	}

	/** Insertion index among the cards of `cardList` for a cursor at `clientY`. */
	private dropIndex(cardList: HTMLElement, clientY: number): number {
		const cards = Array.from(cardList.querySelectorAll<HTMLElement>(".paranoid-card"));
		for (let i = 0; i < cards.length; i++) {
			const rect = cards[i].getBoundingClientRect();
			if (clientY < rect.top + rect.height / 2) return i;
		}
		return cards.length;
	}

	private showIndicator(cardList: HTMLElement, index: number): void {
		if (!this.dropIndicator) this.dropIndicator = createDiv({ cls: "paranoid-drop-indicator" });
		const cards = cardList.querySelectorAll<HTMLElement>(".paranoid-card");
		const before = cards[index] ?? null;
		if (this.dropIndicator.parentElement !== cardList || this.dropIndicator.nextElementSibling !== before) {
			cardList.insertBefore(this.dropIndicator, before);
		}
	}

	private hideIndicator(): void {
		this.dropIndicator?.remove();
	}

	private drop(to: string, toIndex: number): void {
		const dragged = this.dragged;
		this.endDrag();
		if (!dragged) return;
		void this.mutate((l) => moveTask(l, dragged.section, dragged.index, dragged.text, to, toIndex));
	}

	private endDrag(): void {
		this.dragged = null;
		this.contentEl.removeClass("is-dragging-card");
		this.draggedColumn = null;
		this.hideIndicator();
		this.clearColumnDropMarks();
		this.contentEl.querySelectorAll(".is-drop-target").forEach((el) => el.removeClass("is-drop-target"));
	}
}
