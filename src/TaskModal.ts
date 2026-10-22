import { App, ButtonComponent, Modal, Notice, Setting, TextComponent } from "obsidian";
import { ConfirmModal } from "./ConfirmModal";
import { t } from "./i18n";
import { isValidDate, sanitize } from "./tasks";

/**
 * What to do with the details note on save:
 * none — no details before and after; keep — keep (maybe rename);
 * add — create a new note; remove — unlink and trash the note.
 */
export type DetailsAction = "none" | "keep" | "add" | "remove";

export interface TaskModalResult {
	text: string;
	priority: string;
	/** Deadline as YYYY-MM-DD, or null for none. */
	deadline: string | null;
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
	initialDeadline: string | null;
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
	/**
	 * Deletes the task (only for existing tasks; no Delete button otherwise).
	 * Throwing keeps the modal open and shows the error.
	 */
	onDelete?: () => Promise<void>;
	/** Extra line for the delete confirmation, e.g. that the details note goes to trash. */
	deleteNote?: string;
}

/** Details state while the modal is open; changes are applied only on save. */
type DetailsState = "none" | "existing" | "added" | "removed";

export class TaskModal extends Modal {
	private input!: HTMLTextAreaElement;
	private detailsEl!: HTMLElement;
	private priority: string;
	private deadline: string | null;
	private deadlineInput: TextComponent | null = null;
	private detailsState: DetailsState;
	private detailsName: string;
	private submitting = false;

	constructor(app: App, private options: TaskModalOptions) {
		super(app);
		this.priority = options.initialPriority;
		this.deadline = options.initialDeadline;
		this.detailsState = options.initialDetails ? "existing" : options.startWithDetails ? "added" : "none";
		this.detailsName = options.initialDetails ?? "";
	}

	onOpen(): void {
		this.titleEl.setText(this.options.title);

		// Keep a priority that is not in settings (e.g. typed into Main.md by hand) so saving does not drop it.
		const names = [...this.options.priorities];
		if (!names.includes(this.priority)) names.push(this.priority);
		new Setting(this.contentEl).setName(t("modal.priority")).addDropdown((dropdown) => {
			for (const name of names) dropdown.addOption(name, name);
			dropdown.setValue(this.priority).onChange((value) => (this.priority = value));
		});

		new Setting(this.contentEl)
			.setName(t("modal.deadline"))
			.addText((text) => {
				text.inputEl.type = "date";
				text.setValue(this.deadline ?? "").onChange((value) => (this.deadline = isValidDate(value) ? value : null));
				this.deadlineInput = text;
			})
			.addExtraButton((b) =>
				b
					.setIcon("x")
					.setTooltip(t("modal.clearDeadline"))
					.onClick(() => {
						this.deadline = null;
						this.deadlineInput?.setValue("");
					}),
			);

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

		// Footer: Delete on the left (existing tasks only), Save/Cancel on the right.
		const footer = this.contentEl.createDiv({ cls: "paranoid-modal-footer" });
		const left = footer.createDiv();
		const right = footer.createDiv({ cls: "paranoid-modal-footer-right" });
		const { onDelete } = this.options;
		if (onDelete) {
			new ButtonComponent(left)
				.setButtonText(t("common.delete"))
				.onClick(() => this.confirmDelete(onDelete));
		}
		new ButtonComponent(right)
			.setButtonText(t("common.save"))
			.setCta()
			.onClick(() => void this.submit(false));
		new ButtonComponent(right).setButtonText(t("common.cancel")).onClick(() => this.close());

		this.renderDetails();
		this.input.focus();
		this.input.setSelectionRange(this.input.value.length, this.input.value.length);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderDetails(): void {
		this.detailsEl.empty();
		const setting = new Setting(this.detailsEl).setName(t("modal.details"));
		const { detailsFromText, initialDetails, detailsExists } = this.options;

		if (this.detailsState === "none" || this.detailsState === "removed") {
			setting.addButton((b) =>
				b
					.setButtonText(t("common.add"))
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
			const name = initialDetails ?? "";
			setting.setDesc(existing ? (missing ? t("modal.detailsMissing", { name }) : name) : t("modal.detailsFromText"));
		} else {
			if (missing) setting.setDesc(t("modal.noteNotFound"));
			setting.addText((text) =>
				text
					.setPlaceholder(existing ? t("modal.notePlaceholder") : t("modal.sameAsText"))
					.setValue(this.detailsName)
					.onChange((value) => (this.detailsName = value)),
			);
		}

		if (existing && detailsExists) {
			setting.addButton((b) =>
				b
					.setButtonText(t("common.open"))
					.setTooltip(t("modal.openTooltip"))
					.onClick(() => void this.submit(true)),
			);
		}
		setting.addButton((b) =>
			b
				.setButtonText(t("common.delete"))
				.onClick(() => {
					if (!existing || missing) {
						// Nothing on disk yet (or already gone): no need to confirm.
						this.detailsState = existing ? "removed" : "none";
						this.renderDetails();
						return;
					}
					new ConfirmModal(this.app, {
						title: t("modal.deleteDetailsTitle"),
						message: t("modal.deleteDetailsMessage", { name: initialDetails ?? "" }),
						confirmText: t("common.delete"),
						onConfirm: () => {
							this.detailsState = "removed";
							this.renderDetails();
						},
					}).open();
				}),
		);
	}

	private confirmDelete(onDelete: () => Promise<void>): void {
		const { deleteNote } = this.options;
		new ConfirmModal(this.app, {
			title: t("modal.deleteTaskTitle"),
			message: deleteNote ? `${t("modal.deleteTaskMessage")} ${deleteNote}` : t("modal.deleteTaskMessage"),
			confirmText: t("common.delete"),
			onConfirm: () => {
				void (async () => {
					try {
						await onDelete();
						this.close();
					} catch (e) {
						new Notice((e as Error).message);
					}
				})();
			},
		}).open();
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
			new Notice(t("modal.emptyText"));
			return;
		}
		this.submitting = true;
		try {
			await this.options.onSubmit(
				{
					text,
					priority: this.priority,
					deadline: this.deadline,
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
