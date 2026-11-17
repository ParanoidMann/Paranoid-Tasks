import {
	AbstractInputSuggest,
	App,
	getIconIds,
	Notice,
	Platform,
	PluginSettingTab,
	requireApiVersion,
	setIcon,
	Setting,
	SettingDefinition,
	SettingDefinitionGroup,
	SettingDefinitionItem,
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

/** One settings row: what search sees (name, description) and how the controls are built. */
interface SettingRow {
	name: string;
	desc?: string;
	/** Rows without their own name (column and priority lists) are left out of the search. */
	searchable?: boolean;
	visible?: boolean;
	/** Builds the controls; the return value (often the Setting, from chained calls) is ignored. */
	render?: (setting: Setting) => unknown;
}

/** Rows under a heading; the description is shown as a row of its own under the heading. */
interface SettingSection {
	heading?: string;
	desc?: string;
	rows: SettingRow[];
}

export class ParanoidTasksSettingTab extends PluginSettingTab {
	/** Tab shown by the hand-drawn settings of Obsidian before 1.13 (see display). */
	private activeTab: SettingsTab = "general";

	constructor(app: App, private plugin: ParanoidTasksPlugin) {
		super(app, plugin);
	}

	/**
	 * Settings for Obsidian 1.13+, which draws them and indexes them for its settings search:
	 * General inline, Columns and Cards as pages. Built from the current settings on each update.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const items: SettingDefinitionItem[] = this.sections("general").map(toGroup);
		for (const tab of TABS) {
			if (tab.id === "general") continue;
			items.push({ type: "page", name: t(tab.label), items: this.sections(tab.id).map(toGroup) });
		}
		items.push(toDefinition(this.versionRow()));
		return items;
	}

	/** Obsidian before 1.13: the same rows, with tabs drawn by hand. Not called by newer versions. */
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
		for (const section of this.sections(this.activeTab)) {
			if (section.heading) {
				const heading = new Setting(body).setName(section.heading).setHeading();
				if (section.desc) heading.setDesc(section.desc);
			}
			for (const row of section.rows) {
				if (row.visible === false) continue;
				const setting = new Setting(body).setName(row.name);
				if (row.desc) setting.setDesc(row.desc);
				row.render?.(setting);
			}
		}

		containerEl.createDiv({ cls: "paranoid-settings-version", text: this.versionRow().desc });
	}

	/** Redraws the settings after a change, with whichever API this Obsidian version uses. */
	private rerender(): void {
		if (requireApiVersion("1.13.0")) this.update();
		else this.display();
	}

	private sections(tab: SettingsTab): SettingSection[] {
		switch (tab) {
			case "general":
				return this.generalSections();
			case "columns":
				return [this.columnsSection()];
			case "cards":
				return [this.prioritiesSection(), this.deadlineSection(), this.repeatSection(), this.detailsSection()];
		}
	}

	private versionRow(): SettingRow {
		return {
			name: "",
			desc: t("settings.version", { name: this.plugin.manifest.name, version: this.plugin.manifest.version }),
			searchable: false,
		};
	}

	private generalSections(): SettingSection[] {
		const { boardName, boardIcon, language, taskFolder, taskFile } = this.plugin.settings;
		return [
			{
				rows: [
					{
						name: t("settings.language"),
						desc: t("settings.languageDesc"),
						render: (setting) =>
							setting.addDropdown((dropdown) => {
								dropdown.addOption("auto", t("settings.languageAuto"));
								for (const lang of LANGUAGES) dropdown.addOption(lang, t(`language.${lang}`));
								dropdown
									.setValue(language)
									.onChange(
										(value) => void this.run(() => this.plugin.setLanguagePreference(value as LanguagePreference)),
									);
							}),
					},
				],
			},
			{
				heading: t("settings.board"),
				rows: [
					{
						name: t("settings.boardName"),
						desc: t("settings.boardNameDesc"),
						render: (setting) =>
							setting.addText((text) => {
								text.setPlaceholder(t("board.defaultName")).setValue(boardName);
								text.inputEl.addEventListener("change", () => {
									void this.run(() => this.plugin.changeBoardAppearance({ boardName: text.getValue() }));
								});
							}),
					},
					{
						name: t("settings.boardIcon"),
						desc: t("settings.boardIconDesc"),
						render: (setting) => {
							const preview = setting.controlEl.createDiv({ cls: "paranoid-icon-preview" });
							setIcon(preview, boardIcon);
							setting.addText((text) => {
								text.setPlaceholder(DEFAULT_SETTINGS.boardIcon).setValue(boardIcon);
								const apply = (id: string) => void this.run(() => this.plugin.changeBoardAppearance({ boardIcon: id }));
								new IconSuggest(this.app, text.inputEl, apply);
								text.inputEl.addEventListener("change", () => apply(text.getValue()));
							});
						},
					},
				],
			},
			{
				heading: t("settings.storage"),
				desc: t("settings.storageDesc"),
				rows: [
					{
						name: t("settings.taskFolder"),
						desc: t("settings.taskFolderDesc"),
						render: (setting) =>
							setting.addText((text) => {
								text.setPlaceholder(DEFAULT_TASK_FOLDER).setValue(taskFolder);
								const apply = (path: string) => void this.run(() => this.plugin.changeTaskLocation({ taskFolder: path }));
								new FolderSuggest(this.app, text.inputEl, apply);
								text.inputEl.addEventListener("change", () => apply(text.getValue()));
							}),
					},
					{
						name: t("settings.taskFile"),
						desc: t("settings.taskFileDesc"),
						render: (setting) =>
							setting.addText((text) => {
								text.setPlaceholder(DEFAULT_TASK_FILE).setValue(taskFile);
								text.inputEl.addEventListener("change", () => {
									void this.run(() => this.plugin.changeTaskLocation({ taskFile: text.getValue() }));
								});
							}),
					},
				],
			},
		];
	}

	private deadlineSection(): SettingSection {
		const { deadlineShow, deadlineEscalate, deadlineDays, deadlinePriority, priorities } = this.plugin.settings;
		const update = (patch: Parameters<ParanoidTasksPlugin["updateDeadlineSettings"]>[0], rerender = false) =>
			void this.run(() => this.plugin.updateDeadlineSettings(patch), rerender);
		const candidates = priorities.slice(1);
		const priorityDisabled = !deadlineEscalate || candidates.length === 0;

		return {
			heading: t("settings.deadline"),
			rows: [
				this.dialogToggleRow("dialogDeadline"),
				{
					name: t("settings.deadlineShow"),
					desc: t("settings.deadlineShowDesc"),
					render: (setting) =>
						setting.addToggle((toggle) => toggle.setValue(deadlineShow).onChange((value) => update({ deadlineShow: value }))),
				},
				{
					name: t("settings.deadlineEscalate"),
					desc: t("settings.deadlineEscalateDesc"),
					// Re-render to enable/disable the two settings below.
					render: (setting) =>
						setting.addToggle((toggle) =>
							toggle.setValue(deadlineEscalate).onChange((value) => update({ deadlineEscalate: value }, true)),
						),
				},
				{
					name: t("settings.deadlineDays"),
					desc: t("settings.deadlineDaysDesc"),
					render: (setting) =>
						setting.setDisabled(!deadlineEscalate).addText((text) => {
							text.inputEl.type = "number";
							text.inputEl.min = "0";
							text.inputEl.max = "365";
							text.inputEl.addClass("paranoid-number-input");
							text.setValue(String(deadlineDays)).setDisabled(!deadlineEscalate);
							text.inputEl.addEventListener("change", () => {
								update({ deadlineDays: Number(text.getValue()) }, true);
							});
						}),
				},
				{
					name: t("settings.deadlinePriority"),
					desc: candidates.length > 0 ? t("settings.deadlinePriorityDesc") : t("settings.deadlinePriorityNone"),
					render: (setting) =>
						setting.setDisabled(priorityDisabled).addDropdown((dropdown) => {
							for (const p of candidates) dropdown.addOption(p.name, p.name);
							dropdown
								.setValue(deadlinePriority)
								.setDisabled(priorityDisabled)
								.onChange((value) => update({ deadlinePriority: value }));
						}),
				},
			],
		};
	}

	private repeatSection(): SettingSection {
		return {
			heading: t("settings.repeat"),
			desc: t("settings.repeatDesc"),
			rows: [
				this.dialogToggleRow("dialogRepeat"),
				this.toggleRow("repeatShow", t("settings.repeatShow"), t("settings.repeatShowDesc")),
			],
		};
	}

	private detailsSection(): SettingSection {
		return {
			heading: t("settings.details"),
			desc: t("settings.detailsDesc"),
			rows: [
				this.dialogToggleRow("dialogDetails"),
				this.toggleRow("detailsFromText", t("settings.detailsFromText"), t("settings.detailsFromTextDesc")),
				this.toggleRow("detailsByDefault", t("settings.detailsByDefault"), t("settings.detailsByDefaultDesc")),
				this.toggleRow("keepDetailsOnDelete", t("settings.keepDetailsOnDelete"), t("settings.keepDetailsOnDeleteDesc")),
				this.toggleRow("showDetailsIcon", t("settings.showDetailsIcon"), t("settings.showDetailsIconDesc")),
			],
		};
	}

	private columnsSection(): SettingSection {
		const columns = this.plugin.settings.columns;
		const rows: SettingRow[] = [
			{
				name: t("settings.columnDrag"),
				desc: t("settings.columnDragDesc"),
				render: (setting) =>
					setting.addToggle((toggle) =>
						toggle
							.setValue(this.plugin.settings.columnDrag)
							.onChange((value) => void this.run(() => this.plugin.setColumnDrag(value), false)),
					),
			},
			this.toggleRow("reverseColumns", t("settings.reverseColumns"), t("settings.reverseColumnsDesc")),
			{
				name: t("settings.removeZone", { remove: t("board.removeTitle") }),
				desc: t("settings.removeZoneDesc", { remove: ARCHIVE_SECTION }),
				// The zone is never shown on mobile (cards are archived from the long-press menu there).
				visible: !Platform.isMobile,
				render: (setting) =>
					setting.addDropdown((dropdown) => {
						for (const mode of REMOVE_ZONE_MODES) dropdown.addOption(mode, t(`settings.removeZone.${mode}`));
						dropdown
							.setValue(this.plugin.settings.removeZone)
							.onChange(
								(value) =>
									void this.run(() => this.plugin.updateSettings({ removeZone: value as RemoveZoneMode }), false),
							);
					}),
			},
		];

		columns.forEach((column, index) => {
			rows.push({
				name: "",
				searchable: false,
				render: (setting) => {
					setting
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
				},
			});
		});

		rows.push(this.newItemRow(t("settings.newColumn"), t("settings.columnNamePlaceholder"), (name) => this.plugin.addColumn(name)));
		return { heading: t("settings.columns"), desc: t("settings.columnsDesc", { remove: ARCHIVE_SECTION }), rows };
	}

	private prioritiesSection(): SettingSection {
		const priorities = this.plugin.settings.priorities;
		const rows: SettingRow[] = [this.dialogToggleRow("dialogPriority")];

		priorities.forEach((priority, index) => {
			const isDefault = index === 0;
			rows.push({
				name: "",
				desc: isDefault ? t("settings.defaultPriority") : undefined,
				searchable: false,
				render: (setting) => {
					setting
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
				},
			});
		});

		rows.push(this.newItemRow(t("settings.newPriority"), t("settings.newPriorityPlaceholder"), (name) => this.plugin.addPriority(name)));
		return { heading: t("settings.priorities"), desc: t("settings.prioritiesDesc"), rows };
	}

	/** A toggle bound to a boolean setting that does not need a redraw. */
	private toggleRow(
		key: "repeatShow" | "detailsFromText" | "detailsByDefault" | "keepDetailsOnDelete" | "showDetailsIcon" | "reverseColumns",
		name: string,
		desc: string,
	): SettingRow {
		return {
			name,
			desc,
			render: (setting) =>
				setting.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings[key])
						.onChange((value) => void this.run(() => this.plugin.updateSettings({ [key]: value }), false)),
				),
		};
	}

	/** "Show in task dialog" toggle for one of the optional dialog rows. */
	private dialogToggleRow(key: "dialogDetails" | "dialogPriority" | "dialogDeadline" | "dialogRepeat"): SettingRow {
		return {
			name: t("settings.showInDialog"),
			desc: t("settings.showInDialogDesc"),
			render: (setting) =>
				setting.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings[key])
						.onChange((value) => void this.run(() => this.plugin.updateSettings({ [key]: value }), false)),
				),
		};
	}

	/** Text field + Add button (Enter also adds). */
	private newItemRow(label: string, placeholder: string, add: (name: string) => Promise<void>): SettingRow {
		return {
			name: label,
			searchable: false,
			render: (setting) => {
				let newName = "";
				setting
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
			},
		};
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
		if (rerender) this.rerender();
	}
}

/** A row for the declarative settings API: drawn by its render function, or a plain text row. */
function toDefinition(row: SettingRow): SettingDefinition {
	const base = { name: row.name, desc: row.desc, searchable: row.searchable, visible: row.visible };
	const render = row.render;
	if (!render) return base;
	return {
		...base,
		render: (setting: Setting) => {
			render(setting);
		},
	};
}

/** A section as a declarative group; its description becomes a text row under the heading. */
function toGroup(section: SettingSection): SettingDefinitionGroup {
	const items: SettingDefinition[] = [];
	if (section.desc) items.push(toDefinition({ name: "", desc: section.desc, searchable: false }));
	items.push(...section.rows.map(toDefinition));
	return { type: "group", heading: section.heading, items };
}
