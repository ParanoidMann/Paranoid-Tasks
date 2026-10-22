import { App, Modal, Setting } from "obsidian";

export interface ConfirmModalOptions {
	title: string;
	message: string;
	confirmText: string;
	onConfirm: () => void;
}

/** Yes/no dialog with a destructive (red) confirm button. */
export class ConfirmModal extends Modal {
	constructor(app: App, private options: ConfirmModalOptions) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.options.title);
		this.contentEl.createEl("p", { text: this.options.message });
		new Setting(this.contentEl)
			.addButton((b) =>
				b
					.setButtonText(this.options.confirmText)
					.setWarning()
					.onClick(() => {
						this.close();
						this.options.onConfirm();
					}),
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
