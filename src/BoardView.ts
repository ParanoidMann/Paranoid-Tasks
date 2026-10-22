import { ItemView, Notice, setIcon, TAbstractFile, WorkspaceLeaf } from "obsidian";
import type ParanoidTasksPlugin from "./main";
import type { Priority } from "./settings";
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
} from "./tasks";
import { ensureTaskFile, readTasks, TASK_FILE_PATH, updateTasks } from "./taskStore";
import { TaskModal } from "./TaskModal";

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
		return "Task board";
	}

	getIcon(): string {
		return "layout-dashboard";
	}

	async onOpen(): Promise<void> {
		const onChange = (file: TAbstractFile, oldPath?: string) => {
			if (file.path === TASK_FILE_PATH || oldPath === TASK_FILE_PATH) void this.refresh();
		};
		this.registerEvent(this.app.vault.on("modify", onChange));
		this.registerEvent(this.app.vault.on("create", onChange));
		this.registerEvent(this.app.vault.on("delete", onChange));
		this.registerEvent(this.app.vault.on("rename", onChange));

		try {
			await ensureTaskFile(this.app, this.plugin.settings.columns);
		} catch (e) {
			new Notice(`Paranoid Tasks: ${(e as Error).message}`);
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
			await updateTasks(this.app, this.plugin.settings.columns, fn);
		} catch (e) {
			new Notice(`Paranoid Tasks: ${(e as Error).message}`);
		}
	}

	private render(list: TaskList): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("paranoid-board");
		this.dropIndicator = null;

		// Columns come from settings; Remove is only a drop zone.
		this.plugin.settings.columns.forEach((column, index) => {
			const columnEl = this.plugin.settings.collapsed.includes(column)
				? this.renderCollapsedColumn(root, column, getItems(list, column))
				: this.renderColumn(root, column, getItems(list, column));
			this.setupColumnDrag(columnEl, index);
		});
		this.renderRemoveZone(root);
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
			e.dataTransfer?.setData("text/plain", this.plugin.settings.columns[index]);
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
			void this.plugin.moveColumnTo(from, to).catch((err: Error) => new Notice(`Paranoid Tasks: ${err.message}`));
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

	private renderColumn(root: HTMLElement, section: string, items: string[]): HTMLElement {
		const title = section;
		const column = root.createDiv({ cls: "paranoid-column" });

		const header = column.createDiv({ cls: "paranoid-column-header" });
		const toggle = header.createDiv({
			cls: "clickable-icon paranoid-collapse-toggle",
			attr: { "aria-label": "Collapse column" },
		});
		setIcon(toggle, "chevron-down");
		toggle.addEventListener("click", () => void this.plugin.setCollapsed(section, true));
		header.createSpan({ cls: "paranoid-column-title", text: title });
		header.createSpan({ cls: "paranoid-column-count", text: String(items.length) });
		const addButton = header.createDiv({ cls: "clickable-icon paranoid-add", attr: { "aria-label": "Add task" } });
		setIcon(addButton, "plus");
		addButton.addEventListener("click", () => {
			this.openTaskModal(`New task in ${title}`, "", (l, line) => addTask(l, section, line));
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
	private renderCollapsedColumn(root: HTMLElement, section: string, items: string[]): HTMLElement {
		const column = root.createDiv({
			cls: "paranoid-column is-collapsed",
			attr: { "aria-label": `Expand ${section}` },
		});
		setIcon(column.createDiv({ cls: "paranoid-collapse-toggle" }), "chevron-right");
		column.createDiv({ cls: "paranoid-column-title", text: section });
		column.createDiv({ cls: "paranoid-column-count", text: String(items.length) });
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
				attr: { "aria-label": `Unknown priority: ${task.priority}` },
			});
		}
		card.createSpan({ cls: "paranoid-card-text", text: task.text });

		card.addEventListener("click", () => {
			this.openTaskModal("Edit task", text, (l, line) => editTask(l, section, index, text, line));
		});
		card.addEventListener("dragstart", (e) => {
			this.dragged = { section, index, text };
			e.dataTransfer?.setData("text/plain", text);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
			card.addClass("is-dragging");
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
		const defaultName = priorities[0].name;
		new TaskModal(this.app, {
			title,
			initialText: task.text,
			priorities: priorities.map((p) => p.name),
			initialPriority: this.findPriority(task.priority)?.name ?? task.priority ?? defaultName,
			onSubmit: (text, priority) => {
				const line = formatTask(sameTitle(priority, defaultName) ? null : priority, text);
				void this.mutate((l) => apply(l, line));
			},
		}).open();
	}

	private renderRemoveZone(root: HTMLElement): void {
		const zone = root.createDiv({ cls: "paranoid-column paranoid-remove-zone" });
		const header = zone.createDiv({ cls: "paranoid-column-header" });
		header.createSpan({ cls: "paranoid-column-title", text: REMOVE_SECTION });
		const body = zone.createDiv({ cls: "paranoid-remove-body" });
		setIcon(body.createDiv({ cls: "paranoid-remove-icon" }), "trash-2");
		body.createDiv({ text: "Drop here to remove" });

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
		this.draggedColumn = null;
		this.hideIndicator();
		this.clearColumnDropMarks();
		this.contentEl.querySelectorAll(".is-drop-target").forEach((el) => el.removeClass("is-drop-target"));
	}
}
