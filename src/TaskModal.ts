import { App, Modal, Notice, Setting } from "obsidian";
import { sanitize } from "./tasks";

export interface TaskModalOptions {
	title: string;
	initialText: string;
	onSubmit: (text: string) => void;
}

export class TaskModal extends Modal {
	private input!: HTMLTextAreaElement;

	constructor(app: App, private options: TaskModalOptions) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.options.title);

		this.input = this.contentEl.createEl("textarea", { cls: "paranoid-modal-input" });
		this.input.rows = 4;
		this.input.value = this.options.initialText;
		this.input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				this.submit();
			}
		});

		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Save").setCta().onClick(() => this.submit()))
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));

		this.input.focus();
		this.input.setSelectionRange(this.input.value.length, this.input.value.length);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private submit(): void {
		const text = sanitize(this.input.value);
		if (!text) {
			new Notice("Task text is empty");
			return;
		}
		this.close();
		this.options.onSubmit(text);
	}
}
