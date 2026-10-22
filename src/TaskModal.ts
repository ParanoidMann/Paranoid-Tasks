import { App, Modal, Notice, Setting } from "obsidian";
import { sanitize } from "./tasks";

export interface TaskModalOptions {
	title: string;
	initialText: string;
	/** Priority names for the dropdown, in display order. */
	priorities: string[];
	initialPriority: string;
	onSubmit: (text: string, priority: string) => void;
}

export class TaskModal extends Modal {
	private input!: HTMLTextAreaElement;
	private priority: string;

	constructor(app: App, private options: TaskModalOptions) {
		super(app);
		this.priority = options.initialPriority;
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
		this.options.onSubmit(text, this.priority);
	}
}
