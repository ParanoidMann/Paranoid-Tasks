import { ItemView, Notice, setIcon, TAbstractFile, WorkspaceLeaf } from "obsidian";
import { addTask, editTask, moveTask, Section, SECTION_TITLES, TaskList } from "./tasks";
import { ensureTaskFile, readTasks, TASK_FILE_PATH, updateTasks } from "./taskStore";
import { TaskModal } from "./TaskModal";

export const VIEW_TYPE_BOARD = "paranoid-tasks-board";

/** Sections shown as columns with cards. "remove" is only a drop zone. */
const CARD_SECTIONS: Section[] = ["open", "done"];

interface DragState {
	section: Section;
	index: number;
	text: string;
}

export class BoardView extends ItemView {
	private dragged: DragState | null = null;
	private dropIndicator: HTMLElement | null = null;
	private renderToken = 0;

	constructor(leaf: WorkspaceLeaf) {
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
			await ensureTaskFile(this.app);
		} catch (e) {
			new Notice(`Paranoid Tasks: ${(e as Error).message}`);
		}
		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	private async refresh(): Promise<void> {
		const token = ++this.renderToken;
		const list = await readTasks(this.app);
		// A newer refresh started while we were reading; let it win.
		if (token !== this.renderToken) return;
		this.render(list);
	}

	private async mutate(fn: (list: TaskList) => TaskList): Promise<void> {
		try {
			await updateTasks(this.app, fn);
		} catch (e) {
			new Notice(`Paranoid Tasks: ${(e as Error).message}`);
		}
	}

	private render(list: TaskList): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("paranoid-board");
		this.dropIndicator = null;

		for (const section of CARD_SECTIONS) this.renderColumn(root, section, list.sections[section]);
		this.renderRemoveZone(root);
	}

	private renderColumn(root: HTMLElement, section: Section, items: string[]): void {
		const title = SECTION_TITLES[section];
		const column = root.createDiv({ cls: "paranoid-column" });

		const header = column.createDiv({ cls: "paranoid-column-header" });
		header.createSpan({ cls: "paranoid-column-title", text: title });
		header.createSpan({ cls: "paranoid-column-count", text: String(items.length) });
		const addButton = header.createDiv({ cls: "clickable-icon paranoid-add", attr: { "aria-label": "Add task" } });
		setIcon(addButton, "plus");
		addButton.addEventListener("click", () => {
			new TaskModal(this.app, {
				title: `New task in ${title}`,
				initialText: "",
				onSubmit: (text) => void this.mutate((l) => addTask(l, section, text)),
			}).open();
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
	}

	private renderCard(cardList: HTMLElement, section: Section, index: number, text: string): void {
		const card = cardList.createDiv({ cls: "paranoid-card", text });
		card.draggable = true;

		card.addEventListener("click", () => {
			new TaskModal(this.app, {
				title: "Edit task",
				initialText: text,
				onSubmit: (newText) => void this.mutate((l) => editTask(l, section, index, text, newText)),
			}).open();
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

	private renderRemoveZone(root: HTMLElement): void {
		const zone = root.createDiv({ cls: "paranoid-column paranoid-remove-zone" });
		const header = zone.createDiv({ cls: "paranoid-column-header" });
		header.createSpan({ cls: "paranoid-column-title", text: SECTION_TITLES.remove });
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
			this.drop("remove", Number.MAX_SAFE_INTEGER);
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

	private drop(to: Section, toIndex: number): void {
		const dragged = this.dragged;
		this.endDrag();
		if (!dragged) return;
		void this.mutate((l) => moveTask(l, dragged.section, dragged.index, dragged.text, to, toIndex));
	}

	private endDrag(): void {
		this.dragged = null;
		this.hideIndicator();
		this.contentEl.querySelectorAll(".is-drop-target").forEach((el) => el.removeClass("is-drop-target"));
	}
}
