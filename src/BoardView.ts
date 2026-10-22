import { ItemView, Notice, setIcon, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { formatDate, t } from "./i18n";
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
	daysUntil,
	toFileName,
	toISODate,
} from "./tasks";
import { ensureTaskFile, readTasks, taskFilePath, updateTasks } from "./taskStore";
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

	constructor(leaf: WorkspaceLeaf, private plugin: ParanoidTasksPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_BOARD;
	}

	getDisplayText(): string {
		return this.plugin.settings.boardName;
	}

	getIcon(): string {
		return this.plugin.settings.boardIcon;
	}

	async onOpen(): Promise<void> {
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

		// Columns come from settings; Remove is only a drop zone.
		this.plugin.settings.columns.forEach((column, index) => {
			// Collapsed state is kept while collapsing is off, so it comes back when re-enabled.
			const items = getItems(list, column.name);
			const columnEl =
				column.collapsible && column.collapsed
					? this.renderCollapsedColumn(root, column, items)
					: this.renderColumn(root, column, items);
			this.setupColumnDrag(columnEl, index);
		});
		const { removeZone } = this.plugin.settings;
		if (removeZone !== "never") this.renderRemoveZone(root, removeZone === "drag");
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
			const before = this.isLeftHalf(column, e.clientX);
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
			const to = this.isLeftHalf(column, e.clientX) ? index : index + 1;
			this.endDrag();
			void this.plugin.moveColumnTo(from, to).catch((err: Error) => new Notice(t("notice.error", { message: err.message })));
		});
	}

	private isLeftHalf(el: HTMLElement, clientX: number): boolean {
		const rect = el.getBoundingClientRect();
		return clientX < rect.left + rect.width / 2;
	}

	private clearColumnDropMarks(): void {
		this.contentEl
			.querySelectorAll(".is-drop-before, .is-drop-after")
			.forEach((el) => el.removeClasses(["is-drop-before", "is-drop-after"]));
	}

	private renderColumn(root: HTMLElement, config: ColumnConfig, items: string[]): HTMLElement {
		const section = config.name;
		const title = section;
		const column = root.createDiv({ cls: "paranoid-column" });

		const header = column.createDiv({ cls: "paranoid-column-header" });
		if (config.collapsible) {
			const toggle = header.createDiv({
				cls: "clickable-icon paranoid-collapse-toggle",
				attr: { "aria-label": t("board.collapseColumn") },
			});
			setIcon(toggle, "chevron-down");
			toggle.addEventListener("click", () => void this.plugin.setCollapsed(section, true));
		}
		header.createSpan({ cls: "paranoid-column-title", text: title });
		if (config.showCount) {
			header.createSpan({ cls: "paranoid-column-count", text: String(items.length) });
		}
		const addButton = header.createDiv({ cls: "clickable-icon paranoid-add", attr: { "aria-label": t("board.addTask") } });
		setIcon(addButton, "plus");
		addButton.addEventListener("click", () => {
			this.openTaskModal(t("board.newTaskTitle", { column: title }), "", (l, line) => addTask(l, section, line));
		});

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
		card.draggable = true;

		if (priority) {
			const symbol = card.createSpan({ cls: "paranoid-priority", text: priority.symbol });
			symbol.style.color = priority.color;
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

		card.addEventListener("click", () => {
			this.openTaskModal(t("board.editTaskTitle"), text, (l, line) => editTask(l, section, index, text, line));
		});
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
	private openTaskModal(title: string, raw: string, apply: (list: TaskList, line: string) => TaskList): void {
		const task = parseTask(raw);
		const priorities = this.plugin.settings.priorities;
		new TaskModal(this.app, {
			title,
			initialText: task.text,
			priorities: priorities.map((p) => p.name),
			initialPriority: this.findPriority(task.priority)?.name ?? task.priority ?? priorities[0].name,
			initialDeadline: task.deadline,
			initialDetails: task.details,
			detailsExists: task.details !== null && resolveDetails(this.app, task.details) !== null,
			detailsFromText: this.plugin.settings.detailsFromText,
			// raw is "" only for a new task.
			startWithDetails: raw === "" && this.plugin.settings.detailsByDefault,
			onSubmit: (result, open) => this.saveTask(task.details, result, open, apply),
		}).open();
	}

	/**
	 * Writes the task line and creates/renames/trashes the details note.
	 * Order matters: Main.md is updated before a rename so the plugin's rename
	 * handler finds nothing left to fix; a new note is created before it is linked.
	 */
	private async saveTask(
		oldDetails: string | null,
		result: TaskModalResult,
		open: boolean,
		apply: (list: TaskList, line: string) => TaskList,
	): Promise<void> {
		const { priorities, detailsFromText } = this.plugin.settings;
		const columns = this.plugin.columnNames();
		const priority = sameTitle(result.priority, priorities[0].name) ? null : result.priority;
		const write = (details: string | null) =>
			updateTasks(this.app, columns, (l) => apply(l, formatTask({ priority, deadline: result.deadline, details, text: result.text })));
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
