import { App, Modal, Notice, Setting } from "obsidian";
import { ConfirmModal } from "./ConfirmModal";
import { sanitize } from "./tasks";

/**
 * What to do with the details note on save:
 * none — no details before and after; keep — keep (maybe rename);
 * add — create a new note; remove — unlink and trash the note.
 */
export type DetailsAction = "none" | "keep" | "add" | "remove";

export interface TaskModalResult {
	text: string;
	priority: string;
	details: {
		action: DetailsAction;
		/** Note name from the name field (unused when the name follows the task text). */
		name: string;
	};
}

export interface TaskModalOptions {
	title: string;
	initialText: string;
	/** Priority names for the dropdown, in display order. */
	priorities: string[];
	initialPriority: string;
	/** Current details link target, or null if the task has no details. */
	initialDetails: string | null;
	/** Whether the current details note exists in the vault. */
	detailsExists: boolean;
	/** The note name follows the task text, so there is no name field. */
	detailsFromText: boolean;
	/** Start with details added (for new tasks when "Create details by default" is on). */
	startWithDetails: boolean;
	/**
	 * Applies the result; `open` asks to open the details note afterwards.
	 * Throwing keeps the modal open and shows the error.
	 */
	onSubmit: (result: TaskModalResult, open: boolean) => Promise<void>;
}

/** Details state while the modal is open; changes are applied only on save. */
type DetailsState = "none" | "existing" | "added" | "removed";

export class TaskModal extends Modal {
	private input!: HTMLTextAreaElement;
	private detailsEl!: HTMLElement;
	private priority: string;
	private detailsState: DetailsState;
	private detailsName: string;
	private submitting = false;

	constructor(app: App, private options: TaskModalOptions) {
		super(app);
		this.priority = options.initialPriority;
		this.detailsState = options.initialDetails ? "existing" : options.startWithDetails ? "added" : "none";
		this.detailsName = options.initialDetails ?? "";
	}

	onOpen(): void {
		this.titleEl.setText(this.options.title);

		// Keep a priority that is not in settings (e.g. typed into Main.md by hand) so saving does not drop it.
		const names = [...this.options.priorities];
		if (!names.includes(this.priority)) names.push(this.priority);
		new Setting(this.contentEl).setName("Priority").addDropdown((dropdown) => {
			for (const name of names) dropdown.addOption(name, name);
			dropdown.setValue(this.priority).onChange((value) => (this.priority = value));
		});

		this.detailsEl = this.contentEl.createDiv();

		this.input = this.contentEl.createEl("textarea", { cls: "paranoid-modal-input" });
		this.input.rows = 4;
		this.input.value = this.options.initialText;
		this.input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				void this.submit(false);
			}
		});

		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Save").setCta().onClick(() => void this.submit(false)))
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));

		this.renderDetails();
		this.input.focus();
		this.input.setSelectionRange(this.input.value.length, this.input.value.length);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderDetails(): void {
		this.detailsEl.empty();
		const setting = new Setting(this.detailsEl).setName("Details");
		const { detailsFromText, initialDetails, detailsExists } = this.options;

		if (this.detailsState === "none" || this.detailsState === "removed") {
			setting.addButton((b) =>
				b
					.setButtonText("Add")
					.setCta()
					.onClick(() => {
						if (this.detailsState === "removed") {
							// Undo the pending removal instead of creating a second note.
							this.detailsState = "existing";
							this.detailsName = initialDetails ?? "";
						} else {
							this.detailsState = "added";
							this.detailsName = "";
						}
						this.renderDetails();
					}),
			);
			return;
		}

		const existing = this.detailsState === "existing";
		const missing = existing && !detailsExists;
		if (detailsFromText) {
			setting.setDesc(existing ? `${initialDetails}${missing ? " (not found)" : ""}` : "Named after the task text");
		} else {
			if (missing) setting.setDesc("Note not found");
			setting.addText((text) =>
				text
					.setPlaceholder(existing ? "Note name" : "Same as task text")
					.setValue(this.detailsName)
					.onChange((value) => (this.detailsName = value)),
			);
		}

		if (existing && detailsExists) {
			setting.addButton((b) =>
				b
					.setButtonText("Open")
					.setTooltip("Save and open the details note")
					.onClick(() => void this.submit(true)),
			);
		}
		setting.addButton((b) =>
			b
				.setButtonText("Delete")
				.setWarning()
				.onClick(() => {
					if (!existing || missing) {
						// Nothing on disk yet (or already gone): no need to confirm.
						this.detailsState = existing ? "removed" : "none";
						this.renderDetails();
						return;
					}
					new ConfirmModal(this.app, {
						title: "Delete details?",
						message: `The note "${initialDetails}" will be moved to trash when you save the task.`,
						confirmText: "Delete",
						onConfirm: () => {
							this.detailsState = "removed";
							this.renderDetails();
						},
					}).open();
				}),
		);
	}

	private detailsAction(): DetailsAction {
		switch (this.detailsState) {
			case "none":
				return "none";
			case "existing":
				return "keep";
			case "added":
				return "add";
			case "removed":
				return "remove";
		}
	}

	private async submit(open: boolean): Promise<void> {
		if (this.submitting) return;
		const text = sanitize(this.input.value);
		if (!text) {
			new Notice("Task text is empty");
			return;
		}
		this.submitting = true;
		try {
			await this.options.onSubmit(
				{
					text,
					priority: this.priority,
					details: { action: this.detailsAction(), name: sanitize(this.detailsName) },
				},
				open,
			);
			this.close();
		} catch (e) {
			new Notice((e as Error).message);
		} finally {
			this.submitting = false;
		}
	}
}
