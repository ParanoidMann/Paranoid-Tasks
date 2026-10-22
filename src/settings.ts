import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ParanoidTasksPlugin from "./main";
import { REMOVE_SECTION } from "./tasks";

export interface Priority {
	name: string;
	/** Any text or emoji shown before the task text. */
	symbol: string;
	/** CSS color of the symbol (has no effect on color emoji). */
	color: string;
}

export interface ParanoidTasksSettings {
	/** Board columns in display order. Never contains Remove. */
	columns: string[];
	/** Names of columns collapsed on the board. */
	collapsed: string[];
	/** Whether columns can be reordered by dragging on the board. */
	columnDrag: boolean;
	/** Task priorities in dropdown order. The first one is the default and is not written to Main.md. */
	priorities: Priority[];
}

export const DEFAULT_SETTINGS: ParanoidTasksSettings = {
	columns: ["Open", "Done"],
	collapsed: [],
	columnDrag: true,
	priorities: [
		{ name: "Normal", symbol: "●", color: "#4caf50" },
		{ name: "High", symbol: "●", color: "#ff9800" },
	],
};

export class ParanoidTasksSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: ParanoidTasksPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.displayColumns(containerEl);
		this.displayPriorities(containerEl);
	}

	private displayColumns(containerEl: HTMLElement): void {
		const columns = this.plugin.settings.columns;

		new Setting(containerEl)
			.setName("Columns")
			.setDesc(
				`Each column is a section in Tasks/Main.md. Deleting a column moves its tasks to the first remaining column. ` +
					`"${REMOVE_SECTION}" is always present and cannot be changed.`,
			)
			.setHeading();

		new Setting(containerEl)
			.setName("Drag columns on the board")
			.setDesc("Reorder columns by dragging their headers.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.columnDrag)
					.onChange((value) => void this.run(() => this.plugin.setColumnDrag(value), false)),
			);

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

		this.addNewItemRow(containerEl, "New column", "Column name", (name) => this.plugin.addColumn(name));
	}

	private displayPriorities(containerEl: HTMLElement): void {
		const priorities = this.plugin.settings.priorities;

		new Setting(containerEl)
			.setName("Priorities")
			.setDesc(
				"Shown as a symbol before the task text and written to Main.md as [Priority: Name]. " +
					"The first priority is the default: it has no tag and cannot be deleted. " +
					"Deleting a priority makes its tasks default.",
			)
			.setHeading();

		priorities.forEach((priority, index) => {
			const isDefault = index === 0;
			const setting = new Setting(containerEl)
				.setDesc(isDefault ? "Default — not written to Main.md" : "")
				.addText((text) => {
					text.setValue(priority.name).setPlaceholder("Name");
					text.inputEl.addEventListener("change", () => {
						void this.run(() => this.plugin.renamePriority(index, text.getValue()));
					});
				})
				.addText((text) => {
					text.setValue(priority.symbol).setPlaceholder("Symbol");
					text.inputEl.addClass("paranoid-symbol-input");
					text.inputEl.addEventListener("change", () => {
						void this.run(() => this.plugin.updatePriority(index, { symbol: text.getValue() }), false);
					});
				})
				.addColorPicker((picker) =>
					picker
						.setValue(priority.color)
						.onChange((color) => void this.run(() => this.plugin.updatePriority(index, { color }), false)),
				);
			if (isDefault) return;

			setting
				.addExtraButton((b) =>
					b
						.setIcon("arrow-up")
						.setTooltip("Move up")
						.setDisabled(index === 1)
						.onClick(() => void this.run(() => this.plugin.movePriority(index, -1))),
				)
				.addExtraButton((b) =>
					b
						.setIcon("arrow-down")
						.setTooltip("Move down")
						.setDisabled(index === priorities.length - 1)
						.onClick(() => void this.run(() => this.plugin.movePriority(index, 1))),
				)
				.addExtraButton((b) =>
					b
						.setIcon("trash-2")
						.setTooltip("Delete priority")
						.onClick(() => void this.run(() => this.plugin.deletePriority(index))),
				);
		});

		this.addNewItemRow(containerEl, "New priority", "Priority name", (name) => this.plugin.addPriority(name));
	}

	/** Text field + Add button (Enter also adds). */
	private addNewItemRow(
		containerEl: HTMLElement,
		label: string,
		placeholder: string,
		add: (name: string) => Promise<void>,
	): void {
		let newName = "";
		new Setting(containerEl)
			.setName(label)
			.addText((text) => {
				text.setPlaceholder(placeholder).onChange((v) => (newName = v));
				text.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") void this.run(() => add(newName));
				});
			})
			.addButton((b) =>
				b
					.setButtonText("Add")
					.setCta()
					.onClick(() => void this.run(() => add(newName))),
			);
	}

	/**
	 * Runs a settings action and shows errors as notices. Re-renders the tab
	 * when asked or on error (to restore the saved values in the inputs).
	 */
	private async run(action: () => Promise<void>, rerender = true): Promise<void> {
		try {
			await action();
		} catch (e) {
			new Notice((e as Error).message);
			rerender = true;
		}
		if (rerender) this.display();
	}
}
