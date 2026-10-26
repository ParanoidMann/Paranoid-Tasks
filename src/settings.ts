import {
	AbstractInputSuggest,
	App,
	getIconIds,
	Notice,
	PluginSettingTab,
	setIcon,
	Setting,
	TFolder,
	ToggleComponent,
} from "obsidian";
import { Language, LANGUAGES, t, TranslationKey } from "./i18n";
import type ParanoidTasksPlugin from "./main";
import { ARCHIVE_SECTION } from "./tasks";
import { DEFAULT_TASK_FILE, DEFAULT_TASK_FOLDER } from "./taskStore";

export interface Priority {
	name: string;
	/** Any text or emoji shown before the task text. */
	symbol: string;
	/** CSS color of the symbol (has no effect on color emoji). */
	color: string;
}

export interface ColumnConfig {
	/** Column title; also the section heading in the task file. */
	name: string;
	/** Whether the column can be collapsed into a narrow strip. */
	collapsible: boolean;
	/** Show the number of tasks next to the title. */
	showCount: boolean;
	/** Currently collapsed (kept while collapsing is off, so it comes back when re-enabled). */
	collapsed: boolean;
}

export function newColumn(name: string): ColumnConfig {
	return { name, collapsible: true, showCount: true, collapsed: false };
}

export const REMOVE_ZONE_MODES = ["always", "drag", "never"] as const;
export type RemoveZoneMode = (typeof REMOVE_ZONE_MODES)[number];

/** "auto" follows Obsidian's language. */
export type LanguagePreference = "auto" | Language;

export interface ParanoidTasksSettings {
	/** UI language of the plugin. */
	language: LanguagePreference;
	/** Folder with the task file and details notes ("" for the vault root). */
	taskFolder: string;
	/** Task file name without ".md". */
	taskFile: string;
	/** Board title in the ribbon tooltip and the tab header; "" means the localized default. */
	boardName: string;
	/** Icon id of the board in the ribbon and the tab header. */
	boardIcon: string;
	/** Board columns in display order. Never contains Archive. */
	columns: ColumnConfig[];
	/** Whether columns can be reordered by dragging on the board. */
	columnDrag: boolean;
	/** Show the board from the last column to the first, Archive first (display only; the file order stays). */
	reverseColumns: boolean;
	/** When the Archive drop zone is shown on the board (the section stays in the file either way). */
	removeZone: RemoveZoneMode;
	/** Task priorities in dropdown order. The first one is the default and is not written to Main.md. */
	priorities: Priority[];
	/** The details note name always equals the task text (renaming one renames the other). */
	detailsFromText: boolean;
	/** Show an icon opening the details note on cards. */
	showDetailsIcon: boolean;
	/** New tasks start with "Add details" already pressed. */
	detailsByDefault: boolean;
	/** Show the Details / Priority / Deadline rows in the task dialog. */
	dialogDetails: boolean;
	dialogPriority: boolean;
	dialogDeadline: boolean;
	dialogRepeat: boolean;
	/** Show the repeat rule under the task text on cards. */
	repeatShow: boolean;
	/** Keep the details note when its task is deleted (otherwise it goes to trash). */
	keepDetailsOnDelete: boolean;
	/** Show the deadline under the task text on cards. */
	deadlineShow: boolean;
	/** Raise the priority of default-priority tasks as their deadline approaches (rewrites the task file). */
	deadlineEscalate: boolean;
	/** Escalate when at most this many days are left (overdue included). */
	deadlineDays: number;
	/** Priority given by escalation; a non-default priority name. */
	deadlinePriority: string;
}

export const DEFAULT_SETTINGS: ParanoidTasksSettings = {
	language: "auto",
	taskFolder: DEFAULT_TASK_FOLDER,
	taskFile: DEFAULT_TASK_FILE,
	boardName: "",
	boardIcon: "layout-dashboard",
	columns: [newColumn("Open"), newColumn("Done")],
	columnDrag: true,
	reverseColumns: false,
	removeZone: "always",
	priorities: [
		{ name: "Normal", symbol: "●", color: "#4caf50" },
		{ name: "High", symbol: "●", color: "#ff9800" },
	],
	detailsFromText: false,
	showDetailsIcon: true,
	detailsByDefault: false,
	dialogDetails: true,
	dialogPriority: true,
	dialogDeadline: true,
	dialogRepeat: true,
	repeatShow: true,
	keepDetailsOnDelete: false,
	deadlineShow: true,
	deadlineEscalate: false,
	deadlineDays: 3,
	deadlinePriority: "High",
};

type SettingsTab = "general" | "columns" | "cards";

const TABS: { id: SettingsTab; label: TranslationKey }[] = [
	{ id: "general", label: "settings.tab.general" },
	{ id: "columns", label: "settings.tab.columns" },
	{ id: "cards", label: "settings.tab.cards" },
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

/** Suggests icon ids (with a preview) while typing into a text input. */
class IconSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private onPick: (id: string) => void,
	) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): string[] {
		const q = query.toLowerCase().trim();
		return getIconIds()
			.filter((id) => id.includes(q))
			.slice(0, 100);
	}

	renderSuggestion(id: string, el: HTMLElement): void {
		el.addClass("paranoid-icon-suggestion");
		setIcon(el.createSpan(), id);
		el.createSpan({ text: id });
	}

	selectSuggestion(id: string): void {
		this.setValue(id);
		this.close();
		this.onPick(id);
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
			const button = nav.createEl("button", { cls: "paranoid-settings-tab", text: t(tab.label) });
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
				this.displayDeadline(body);
				this.displayRepeat(body);
				this.displayDetails(body);
				break;
		}

		containerEl.createDiv({
			cls: "paranoid-settings-version",
			text: t("settings.version", { name: this.plugin.manifest.name, version: this.plugin.manifest.version }),
		});
	}

	private displayGeneral(containerEl: HTMLElement): void {
		const { boardName, boardIcon, language } = this.plugin.settings;

		new Setting(containerEl)
			.setName(t("settings.language"))
			.setDesc(t("settings.languageDesc"))
			.addDropdown((dropdown) => {
				dropdown.addOption("auto", t("settings.languageAuto"));
				for (const lang of LANGUAGES) dropdown.addOption(lang, t(`language.${lang}`));
				dropdown
					.setValue(language)
					.onChange(
						(value) => void this.run(() => this.plugin.setLanguagePreference(value as LanguagePreference)),
					);
			});

		new Setting(containerEl).setName(t("settings.board")).setHeading();

		new Setting(containerEl)
			.setName(t("settings.boardName"))
			.setDesc(t("settings.boardNameDesc"))
			.addText((text) => {
				text.setPlaceholder(t("board.defaultName")).setValue(boardName);
				text.inputEl.addEventListener("change", () => {
					void this.run(() => this.plugin.changeBoardAppearance({ boardName: text.getValue() }));
				});
			});

		const iconSetting = new Setting(containerEl)
			.setName(t("settings.boardIcon"))
			.setDesc(t("settings.boardIconDesc"));
		const preview = iconSetting.controlEl.createDiv({ cls: "paranoid-icon-preview" });
		setIcon(preview, boardIcon);
		iconSetting.addText((text) => {
			text.setPlaceholder(DEFAULT_SETTINGS.boardIcon).setValue(boardIcon);
			const apply = (id: string) => void this.run(() => this.plugin.changeBoardAppearance({ boardIcon: id }));
			new IconSuggest(this.app, text.inputEl, apply);
			text.inputEl.addEventListener("change", () => apply(text.getValue()));
		});

		new Setting(containerEl)
			.setName(t("settings.storage"))
			.setDesc(t("settings.storageDesc"))
			.setHeading();

		const { taskFolder, taskFile } = this.plugin.settings;
		new Setting(containerEl)
			.setName(t("settings.taskFolder"))
			.setDesc(t("settings.taskFolderDesc"))
			.addText((text) => {
				text.setPlaceholder(DEFAULT_TASK_FOLDER).setValue(taskFolder);
				const apply = (path: string) =>
					void this.run(() => this.plugin.changeTaskLocation({ taskFolder: path }));
				new FolderSuggest(this.app, text.inputEl, apply);
				text.inputEl.addEventListener("change", () => apply(text.getValue()));
			});

		new Setting(containerEl)
			.setName(t("settings.taskFile"))
			.setDesc(t("settings.taskFileDesc"))
			.addText((text) => {
				text.setPlaceholder(DEFAULT_TASK_FILE).setValue(taskFile);
				text.inputEl.addEventListener("change", () => {
					void this.run(() => this.plugin.changeTaskLocation({ taskFile: text.getValue() }));
				});
			});
	}

	private displayDeadline(containerEl: HTMLElement): void {
		const { deadlineShow, deadlineEscalate, deadlineDays, deadlinePriority, priorities } = this.plugin.settings;
		const update = (patch: Parameters<ParanoidTasksPlugin["updateDeadlineSettings"]>[0], rerender = false) =>
			void this.run(() => this.plugin.updateDeadlineSettings(patch), rerender);

		new Setting(containerEl).setName(t("settings.deadline")).setHeading();
		this.addDialogToggle(containerEl, "dialogDeadline");

		new Setting(containerEl)
			.setName(t("settings.deadlineShow"))
			.setDesc(t("settings.deadlineShowDesc"))
			.addToggle((toggle) => toggle.setValue(deadlineShow).onChange((value) => update({ deadlineShow: value })));

		new Setting(containerEl)
			.setName(t("settings.deadlineEscalate"))
			.setDesc(t("settings.deadlineEscalateDesc"))
			// Re-render to enable/disable the two settings below.
			.addToggle((toggle) =>
				toggle.setValue(deadlineEscalate).onChange((value) => update({ deadlineEscalate: value }, true)),
			);

		new Setting(containerEl)
			.setName(t("settings.deadlineDays"))
			.setDesc(t("settings.deadlineDaysDesc"))
			.setDisabled(!deadlineEscalate)
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "0";
				text.inputEl.max = "365";
				text.inputEl.addClass("paranoid-number-input");
				text.setValue(String(deadlineDays)).setDisabled(!deadlineEscalate);
				text.inputEl.addEventListener("change", () => {
					update({ deadlineDays: Number(text.getValue()) }, true);
				});
			});

		const candidates = priorities.slice(1);
		new Setting(containerEl)
			.setName(t("settings.deadlinePriority"))
			.setDesc(candidates.length > 0 ? t("settings.deadlinePriorityDesc") : t("settings.deadlinePriorityNone"))
			.setDisabled(!deadlineEscalate || candidates.length === 0)
			.addDropdown((dropdown) => {
				for (const p of candidates) dropdown.addOption(p.name, p.name);
				dropdown
					.setValue(deadlinePriority)
					.setDisabled(!deadlineEscalate || candidates.length === 0)
					.onChange((value) => update({ deadlinePriority: value }));
			});
	}

	private displayRepeat(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t("settings.repeat")).setDesc(t("settings.repeatDesc")).setHeading();
		this.addDialogToggle(containerEl, "dialogRepeat");

		new Setting(containerEl)
			.setName(t("settings.repeatShow"))
			.setDesc(t("settings.repeatShowDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.repeatShow)
					.onChange((value) => void this.run(() => this.plugin.updateSettings({ repeatShow: value }), false)),
			);
	}

	private displayDetails(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t("settings.details"))
			.setDesc(t("settings.detailsDesc"))
			.setHeading();
		this.addDialogToggle(containerEl, "dialogDetails");

		new Setting(containerEl)
			.setName(t("settings.detailsFromText"))
			.setDesc(t("settings.detailsFromTextDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.detailsFromText)
					.onChange(
						(value) => void this.run(() => this.plugin.updateSettings({ detailsFromText: value }), false),
					),
			);

		new Setting(containerEl)
			.setName(t("settings.detailsByDefault"))
			.setDesc(t("settings.detailsByDefaultDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.detailsByDefault)
					.onChange(
						(value) => void this.run(() => this.plugin.updateSettings({ detailsByDefault: value }), false),
					),
			);

		new Setting(containerEl)
			.setName(t("settings.keepDetailsOnDelete"))
			.setDesc(t("settings.keepDetailsOnDeleteDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.keepDetailsOnDelete)
					.onChange(
						(value) => void this.run(() => this.plugin.updateSettings({ keepDetailsOnDelete: value }), false),
					),
			);

		new Setting(containerEl)
			.setName(t("settings.showDetailsIcon"))
			.setDesc(t("settings.showDetailsIconDesc"))
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
			.setName(t("settings.columns"))
			.setDesc(t("settings.columnsDesc", { remove: ARCHIVE_SECTION }))
			.setHeading();

		new Setting(containerEl)
			.setName(t("settings.columnDrag"))
			.setDesc(t("settings.columnDragDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.columnDrag)
					.onChange((value) => void this.run(() => this.plugin.setColumnDrag(value), false)),
			);

		new Setting(containerEl)
			.setName(t("settings.reverseColumns"))
			.setDesc(t("settings.reverseColumnsDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.reverseColumns)
					.onChange(
						(value) => void this.run(() => this.plugin.updateSettings({ reverseColumns: value }), false),
					),
			);

		new Setting(containerEl)
			.setName(t("settings.removeZone", { remove: t("board.removeTitle") }))
			.setDesc(t("settings.removeZoneDesc", { remove: ARCHIVE_SECTION }))
			.addDropdown((dropdown) => {
				for (const mode of REMOVE_ZONE_MODES) dropdown.addOption(mode, t(`settings.removeZone.${mode}`));
				dropdown
					.setValue(this.plugin.settings.removeZone)
					.onChange(
						(value) =>
							void this.run(() => this.plugin.updateSettings({ removeZone: value as RemoveZoneMode }), false),
					);
			});

		columns.forEach((column, index) => {
			const setting = new Setting(containerEl)
				.addText((text) => {
					text.setValue(column.name);
					// "change" fires on blur/Enter, so the file is not rewritten on every keystroke.
					text.inputEl.addEventListener("change", () => {
						void this.run(() => this.plugin.renameColumn(index, text.getValue()));
					});
				})
				.addExtraButton((b) =>
					b
						.setIcon("arrow-up")
						.setTooltip(t("common.moveUp"))
						.setDisabled(index === 0)
						.onClick(() => void this.run(() => this.plugin.moveColumn(index, -1))),
				)
				.addExtraButton((b) =>
					b
						.setIcon("arrow-down")
						.setTooltip(t("common.moveDown"))
						.setDisabled(index === columns.length - 1)
						.onClick(() => void this.run(() => this.plugin.moveColumn(index, 1))),
				)
				.addExtraButton((b) =>
					b
						.setIcon("trash-2")
						.setTooltip(t("settings.deleteColumn"))
						.onClick(() => void this.run(() => this.plugin.deleteColumn(index))),
				);
			setting.settingEl.addClass("paranoid-column-setting");

			// Per-column options under the name: small labelled toggles.
			const options = setting.infoEl.createDiv({ cls: "paranoid-column-options" });
			const addOption = (label: string, tooltip: string, value: boolean, onChange: (v: boolean) => void) => {
				const option = options.createEl("label", { cls: "paranoid-column-option", attr: { "aria-label": tooltip } });
				new ToggleComponent(option).setValue(value).onChange(onChange);
				option.createSpan({ text: label });
			};
			addOption(t("settings.collapsible"), t("settings.collapsibleTooltip"), column.collapsible, (collapsible) => {
				void this.run(() => this.plugin.updateColumn(index, { collapsible }), false);
			});
			addOption(t("settings.taskCount"), t("settings.taskCountTooltip"), column.showCount, (showCount) => {
				void this.run(() => this.plugin.updateColumn(index, { showCount }), false);
			});
		});

		this.addNewItemRow(containerEl, t("settings.newColumn"), t("settings.columnNamePlaceholder"), (name) => this.plugin.addColumn(name));
	}

	private displayPriorities(containerEl: HTMLElement): void {
		const priorities = this.plugin.settings.priorities;

		new Setting(containerEl)
			.setName(t("settings.priorities"))
			.setDesc(t("settings.prioritiesDesc"))
			.setHeading();
		this.addDialogToggle(containerEl, "dialogPriority");

		priorities.forEach((priority, index) => {
			const isDefault = index === 0;
			const setting = new Setting(containerEl)
				.setDesc(isDefault ? t("settings.defaultPriority") : "")
				.addText((text) => {
					text.setValue(priority.name).setPlaceholder(t("settings.priorityNamePlaceholder"));
					text.inputEl.addEventListener("change", () => {
						void this.run(() => this.plugin.renamePriority(index, text.getValue()));
					});
				})
				.addText((text) => {
					text.setValue(priority.symbol).setPlaceholder(t("settings.symbolPlaceholder"));
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
						.setTooltip(t("common.moveUp"))
						.setDisabled(index === 1)
						.onClick(() => void this.run(() => this.plugin.movePriority(index, -1))),
				)
				.addExtraButton((b) =>
					b
						.setIcon("arrow-down")
						.setTooltip(t("common.moveDown"))
						.setDisabled(index === priorities.length - 1)
						.onClick(() => void this.run(() => this.plugin.movePriority(index, 1))),
				)
				.addExtraButton((b) =>
					b
						.setIcon("trash-2")
						.setTooltip(t("settings.deletePriority"))
						.onClick(() => void this.run(() => this.plugin.deletePriority(index))),
				);
		});

		this.addNewItemRow(containerEl, t("settings.newPriority"), t("settings.newPriorityPlaceholder"), (name) => this.plugin.addPriority(name));
	}

	/** "Show in task dialog" toggle for one of the optional dialog rows. */
	private addDialogToggle(containerEl: HTMLElement, key: "dialogDetails" | "dialogPriority" | "dialogDeadline" | "dialogRepeat"): void {
		new Setting(containerEl)
			.setName(t("settings.showInDialog"))
			.setDesc(t("settings.showInDialogDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings[key])
					.onChange((value) => void this.run(() => this.plugin.updateSettings({ [key]: value }), false)),
			);
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
					.setButtonText(t("common.add"))
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
