import { App, ButtonComponent, Modal, Notice, Setting, TextComponent } from "obsidian";
import { ConfirmModal } from "./ConfirmModal";
import { t, TranslationKey } from "./i18n";
import { formatRepeat, isValidDate, parseRepeat, RepeatRule, sanitize } from "./tasks";

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
	/** Repeat rule (e.g. "daily 09:00"), or null for a one-off task. */
	repeat: string | null;
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
	initialRepeat: string | null;
	/** Current details link target, or null if the task has no details. */
	initialDetails: string | null;
	/** Whether the current details note exists in the vault. */
	detailsExists: boolean;
	/** The note name follows the task text, so there is no name field. */
	detailsFromText: boolean;
	/** Which optional rows the dialog shows; hidden values are kept as they are. */
	fields: { details: boolean; priority: boolean; deadline: boolean; repeat: boolean };
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

/** Frequency options in the dialog; the "…At" ones are the same kinds with a weekday/day and a time. */
const REPEAT_CHOICES = ["hourly", "daily", "dailyAt", "weekly", "weeklyAt", "monthly", "monthlyAt", "yearly"] as const;
type RepeatChoice = (typeof REPEAT_CHOICES)[number];

/** Rule for a freshly picked frequency: 09:00, on Monday / the 1st where applicable. */
function defaultRule(choice: RepeatChoice): RepeatRule {
	switch (choice) {
		case "dailyAt":
			return { kind: "daily", time: "09:00" };
		case "weeklyAt":
			return { kind: "weekly", weekday: 1, time: "09:00" };
		case "monthlyAt":
			return { kind: "monthly", day: 1, time: "09:00" };
		default:
			return { kind: choice };
	}
}

/** Details state while the modal is open; changes are applied only on save. */
type DetailsState = "none" | "existing" | "added" | "removed";

export class TaskModal extends Modal {
	private input!: HTMLTextAreaElement;
	private detailsEl: HTMLElement | null = null;
	private priority: string;
	private deadline: string | null;
	private repeat: RepeatRule | null;
	private repeatEl: HTMLElement | null = null;
	private deadlineInput: TextComponent | null = null;
	private detailsState: DetailsState;
	private detailsName: string;
	private submitting = false;

	constructor(app: App, private options: TaskModalOptions) {
		super(app);
		this.priority = options.initialPriority;
		this.deadline = options.initialDeadline;
		this.repeat = options.initialRepeat ? parseRepeat(options.initialRepeat) : null;
		this.detailsState = options.initialDetails ? "existing" : options.startWithDetails ? "added" : "none";
		this.detailsName = options.initialDetails ?? "";
	}

	onOpen(): void {
		this.titleEl.setText(this.options.title);
		this.modalEl.addClass("paranoid-task-modal");
		// Compact label/control rows (styled in styles.css), then the task text below.
		// Rows can be hidden in settings; then their current values are saved unchanged.
		const shown = this.options.fields;
		const fields =
			shown.details || shown.priority || shown.deadline || shown.repeat
				? this.contentEl.createDiv({ cls: "paranoid-task-fields" })
				: null;
		// Details first, then priority and deadline.
		if (fields && shown.details) this.detailsEl = fields.createDiv();
		if (fields && shown.priority) this.renderPriority(fields);
		if (fields && shown.deadline) this.renderDeadline(fields);
		if (fields && shown.repeat) {
			this.repeatEl = fields.createDiv();
			this.renderRepeat();
		}

		const label = this.contentEl.createEl("label", { cls: "paranoid-modal-label", text: t("modal.text") });
		this.input = this.contentEl.createEl("textarea", { cls: "paranoid-modal-input" });
		this.input.id = "paranoid-task-text";
		label.htmlFor = this.input.id;
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

	private renderPriority(containerEl: HTMLElement): void {
		// Keep a priority that is not in settings (e.g. typed into Main.md by hand) so saving does not drop it.
		const names = [...this.options.priorities];
		if (!names.includes(this.priority)) names.push(this.priority);
		new Setting(containerEl).setName(t("modal.priority")).addDropdown((dropdown) => {
			for (const name of names) dropdown.addOption(name, name);
			dropdown.setValue(this.priority).onChange((value) => (this.priority = value));
		});
	}

	private renderDeadline(containerEl: HTMLElement): void {
		new Setting(containerEl)
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
	}

	/** "Recurring task" toggle and, when on, the frequency (with weekday/day and time for the "…at" options). */
	private renderRepeat(): void {
		const el = this.repeatEl;
		if (!el) return;
		el.empty();

		new Setting(el).setName(t("modal.repeat")).addToggle((toggle) =>
			toggle.setValue(this.repeat !== null).onChange((on) => {
				this.repeat = on ? { kind: "daily" } : null;
				this.renderRepeat();
			}),
		);
		if (!this.repeat) return;

		const rule = this.repeat;
		const choice: RepeatChoice = !rule.time ? rule.kind : rule.kind === "daily" ? "dailyAt" : rule.kind === "weekly" ? "weeklyAt" : "monthlyAt";
		const setting = new Setting(el).setName(t("modal.repeatEvery")).addDropdown((dropdown) => {
			for (const option of REPEAT_CHOICES) dropdown.addOption(option, t(`repeat.${option}`));
			dropdown.setValue(choice).onChange((value) => {
				this.repeat = defaultRule(value as RepeatChoice);
				this.renderRepeat();
			});
		});

		if (choice === "weeklyAt") {
			setting.addDropdown((dropdown) => {
				for (let weekday = 1; weekday <= 7; weekday++) {
					dropdown.addOption(String(weekday), t(`weekday.${weekday}` as TranslationKey));
				}
				dropdown.setValue(String(rule.weekday ?? 1)).onChange((value) => {
					this.repeat = { ...rule, weekday: Number(value) };
				});
			});
		}
		if (choice === "monthlyAt") {
			setting.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.inputEl.max = "31";
				text.inputEl.addClass("paranoid-number-input");
				text.inputEl.setAttr("aria-label", t("modal.repeatDay"));
				text.setValue(String(rule.day ?? 1)).onChange((value) => {
					const day = Number(value);
					if (Number.isInteger(day) && day >= 1 && day <= 31) this.repeat = { ...(this.repeat ?? rule), day };
				});
			});
		}
		if (choice === "dailyAt" || choice === "weeklyAt" || choice === "monthlyAt") {
			setting.addText((text) => {
				text.inputEl.type = "time";
				text.setValue(rule.time ?? "09:00").onChange((value) => {
					if (/^\d{2}:\d{2}$/.test(value)) this.repeat = { ...(this.repeat ?? rule), time: value };
				});
			});
		}
	}

	private renderDetails(): void {
		if (!this.detailsEl) return;
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
			const text = existing ? (missing ? t("modal.detailsMissing", { name }) : name) : t("modal.detailsFromText");
			setting.controlEl.createSpan({ cls: "paranoid-details-name", text });
		} else {
			if (missing) setting.controlEl.createSpan({ cls: "paranoid-details-name", text: t("modal.noteNotFound") });
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
					repeat: this.repeat ? formatRepeat(this.repeat) : null,
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
