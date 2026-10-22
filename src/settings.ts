import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ParanoidTasksPlugin from "./main";
import { REMOVE_SECTION } from "./tasks";

export interface ParanoidTasksSettings {
	/** Board columns in display order. Never contains Remove. */
	columns: string[];
	/** Names of columns collapsed on the board. */
	collapsed: string[];
}

export const DEFAULT_SETTINGS: ParanoidTasksSettings = {
	columns: ["Open", "Done"],
	collapsed: [],
};

export class ParanoidTasksSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: ParanoidTasksPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const columns = this.plugin.settings.columns;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Columns")
			.setDesc(
				`Each column is a section in Tasks/Main.md. Deleting a column moves its tasks to the first remaining column. ` +
					`"${REMOVE_SECTION}" is always present and cannot be changed.`,
			)
			.setHeading();

		columns.forEach((name, index) => {
			new Setting(containerEl)
				.addText((text) => {
					text.setValue(name);
					// "change" fires on blur/Enter, so the file is not rewritten on every keystroke.
					text.inputEl.addEventListener("change", () => {
						void this.run(() => this.plugin.renameColumn(index, text.getValue()));
					});
				})
				.addExtraButton((b) =>
					b
						.setIcon("arrow-up")
						.setTooltip("Move up")
						.setDisabled(index === 0)
						.onClick(() => void this.run(() => this.plugin.moveColumn(index, -1))),
				)
				.addExtraButton((b) =>
					b
						.setIcon("arrow-down")
						.setTooltip("Move down")
						.setDisabled(index === columns.length - 1)
						.onClick(() => void this.run(() => this.plugin.moveColumn(index, 1))),
				)
				.addExtraButton((b) =>
					b
						.setIcon("trash-2")
						.setTooltip("Delete column")
						.onClick(() => void this.run(() => this.plugin.deleteColumn(index))),
				);
		});

		let newName = "";
		new Setting(containerEl)
			.setName("New column")
			.addText((text) => {
				text.setPlaceholder("Column name").onChange((v) => (newName = v));
				text.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") void this.run(() => this.plugin.addColumn(newName));
				});
			})
			.addButton((b) =>
				b
					.setButtonText("Add")
					.setCta()
					.onClick(() => void this.run(() => this.plugin.addColumn(newName))),
			);
	}

	/** Runs a settings action, shows errors as notices and re-renders the tab. */
	private async run(action: () => Promise<void>): Promise<void> {
		try {
			await action();
		} catch (e) {
			new Notice((e as Error).message);
		}
		this.display();
	}
}
