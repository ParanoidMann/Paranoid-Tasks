import { AbstractInputSuggest, App, Notice, PluginSettingTab, Setting, TFolder } from "obsidian";
import type ParanoidTasksPlugin from "./main";
import { REMOVE_SECTION } from "./tasks";
import { DEFAULT_TASK_FILE, DEFAULT_TASK_FOLDER } from "./taskStore";

export interface Priority {
	name: string;
	/** Any text or emoji shown before the task text. */
	symbol: string;
	/** CSS color of the symbol (has no effect on color emoji). */
	color: string;
}

export interface ParanoidTasksSettings {
	/** Folder with the task file and details notes ("" for the vault root). */
	taskFolder: string;
	/** Task file name without ".md". */
	taskFile: string;
	/** Board columns in display order. Never contains Remove. */
	columns: string[];
	/** Names of columns collapsed on the board. */
	collapsed: string[];
	/** Whether columns can be reordered by dragging on the board. */
	columnDrag: boolean;
	/** Task priorities in dropdown order. The first one is the default and is not written to Main.md. */
	priorities: Priority[];
	/** The details note name always equals the task text (renaming one renames the other). */
	detailsFromText: boolean;
	/** Show an icon opening the details note on cards. */
	showDetailsIcon: boolean;
}

export const DEFAULT_SETTINGS: ParanoidTasksSettings = {
	taskFolder: DEFAULT_TASK_FOLDER,
	taskFile: DEFAULT_TASK_FILE,
	columns: ["Open", "Done"],
	collapsed: [],
	columnDrag: true,
	priorities: [
		{ name: "Normal", symbol: "●", color: "#4caf50" },
		{ name: "High", symbol: "●", color: "#ff9800" },
	],
	detailsFromText: false,
	showDetailsIcon: true,
};

type SettingsTab = "general" | "columns" | "cards";

const TABS: { id: SettingsTab; label: string }[] = [
	{ id: "general", label: "General" },
	{ id: "columns", label: "Columns" },
	{ id: "cards", label: "Cards" },
];

/** Suggests vault folders while typing into a text input. */
class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private onPick: (path: string) => void,
	) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): TFolder[] {
		const q = query.toLowerCase();
		return this.app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder && f.path.toLowerCase().includes(q))
			.slice(0, 50);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.isRoot() ? "/" : folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		const path = folder.isRoot() ? "" : folder.path;
		this.setValue(path);
		this.close();
		this.onPick(path);
	}
}

export class ParanoidTasksSettingTab extends PluginSettingTab {
	private activeTab: SettingsTab = "general";

	constructor(app: App, private plugin: ParanoidTasksPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const nav = containerEl.createDiv({ cls: "paranoid-settings-tabs" });
		for (const tab of TABS) {
			const button = nav.createEl("button", { cls: "paranoid-settings-tab", text: tab.label });
			if (tab.id === this.activeTab) button.addClass("is-active");
			button.addEventListener("click", () => {
				this.activeTab = tab.id;
				this.display();
			});
		}

		const body = containerEl.createDiv();
		switch (this.activeTab) {
			case "general":
				this.displayGeneral(body);
				break;
			case "columns":
				this.displayColumns(body);
				break;
			case "cards":
				this.displayPriorities(body);
				this.displayDetails(body);
				break;
		}

		containerEl.createDiv({
			cls: "paranoid-settings-version",
			text: `${this.plugin.manifest.name} v${this.plugin.manifest.version}`,
		});
	}

	private displayGeneral(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Storage")
			.setDesc(
				"Where the task list and details notes are kept. Changing these only switches the board to another file; " +
					"existing files are not moved. A missing file is created.",
			)
			.setHeading();

		const { taskFolder, taskFile } = this.plugin.settings;
		new Setting(containerEl)
			.setName("Task folder")
			.setDesc("Vault folder for the task file and new details notes. Empty means the vault root.")
			.addText((text) => {
				text.setPlaceholder(DEFAULT_TASK_FOLDER).setValue(taskFolder);
				const apply = (path: string) =>
					void this.run(() => this.plugin.changeTaskLocation({ taskFolder: path }));
				new FolderSuggest(this.app, text.inputEl, apply);
				text.inputEl.addEventListener("change", () => apply(text.getValue()));
			});

		new Setting(containerEl)
			.setName("Task file")
			.setDesc("Name of the note with the task list, without .md.")
			.addText((text) => {
				text.setPlaceholder(DEFAULT_TASK_FILE).setValue(taskFile);
				text.inputEl.addEventListener("change", () => {
					void this.run(() => this.plugin.changeTaskLocation({ taskFile: text.getValue() }));
				});
			});
	}

	private displayDetails(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Details")
			.setDesc("A task can have a details note in the task folder, linked as [Details: [[Name]]].")
			.setHeading();

		new Setting(containerEl)
			.setName("Task text is the details file name")
			.setDesc(
				"On: the note is named after the task text; editing the text renames the note and renaming the note changes the text. " +
					"Off: the note name is set separately in the task dialog.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.detailsFromText)
					.onChange(
						(value) => void this.run(() => this.plugin.updateSettings({ detailsFromText: value }), false),
					),
			);

		new Setting(containerEl)
			.setName("Show details icon on cards")
			.setDesc("Clicking the icon opens the details note.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showDetailsIcon)
					.onChange(
						(value) => void this.run(() => this.plugin.updateSettings({ showDetailsIcon: value }), false),
					),
			);
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
