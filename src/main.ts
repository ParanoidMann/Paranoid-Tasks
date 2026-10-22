import { getIconIds, getLanguage, normalizePath, Notice, Plugin, setIcon, TAbstractFile, TFile } from "obsidian";
import { BoardView, VIEW_TYPE_BOARD } from "./BoardView";
import { Language, LANGUAGES, setLanguage, t } from "./i18n";
import {
	ColumnConfig,
	DEFAULT_SETTINGS,
	LanguagePreference,
	newColumn,
	ParanoidTasksSettings,
	ParanoidTasksSettingTab,
	Priority,
} from "./settings";
import {
	clearPriority,
	DEFAULT_COLUMN,
	mergeSection,
	renameDetails,
	renamePriority as renamePriorityTags,
	renameSection,
	sanitize,
	serialize,
	TaskList,
	toFileName,
	validateColumnName,
	validatePriorityName,
} from "./tasks";
import { ensureTaskFile, readTasks, setTaskLocation, taskFilePath, taskFolder, updateTasks } from "./taskStore";

export default class ParanoidTasksPlugin extends Plugin {
	settings: ParanoidTasksSettings = { ...DEFAULT_SETTINGS };
	private ribbonEl: HTMLElement | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.applyLanguage();

		this.registerView(VIEW_TYPE_BOARD, (leaf) => new BoardView(leaf, this));
		this.addSettingTab(new ParanoidTasksSettingTab(this.app, this));

		this.ribbonEl = this.addRibbonIcon(this.settings.boardIcon, this.boardTitle(), () => void this.activateView());
		this.addCommand({
			id: "open-board",
			// Obsidian keeps the name it was registered with, so a language change shows here after a restart.
			name: t("command.openBoard"),
			callback: () => void this.activateView(),
		});

		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => void this.onFileRenamed(file, oldPath)));
	}

	/**
	 * Points the board to another task file (existing files are not moved).
	 * The file is created if missing; on failure the previous location is kept.
	 */
	async changeTaskLocation(patch: { taskFolder?: string; taskFile?: string }): Promise<void> {
		const folder = patch.taskFolder !== undefined ? toFolderPath(patch.taskFolder) : this.settings.taskFolder;
		const file = patch.taskFile !== undefined ? toTaskFileName(patch.taskFile) : this.settings.taskFile;
		if (!file) throw new Error(t("error.taskFileEmpty"));
		if (folder === this.settings.taskFolder && file === this.settings.taskFile) return;

		setTaskLocation(folder, file);
		try {
			await ensureTaskFile(this.app, this.columnNames());
		} catch (e) {
			setTaskLocation(this.settings.taskFolder, this.settings.taskFile);
			throw e;
		}
		await this.updateSettings({ taskFolder: folder, taskFile: file });
	}

	/** Board title: the custom name, or the default one in the current language. */
	boardTitle(): string {
		return this.settings.boardName || t("board.defaultName");
	}

	/** Changes the board name/icon shown in the ribbon and on open board tabs. An empty name means the default. */
	async changeBoardAppearance(patch: { boardName?: string; boardIcon?: string }): Promise<void> {
		const name = patch.boardName !== undefined ? sanitize(patch.boardName) : this.settings.boardName;
		const icon = patch.boardIcon !== undefined ? patch.boardIcon.trim() : this.settings.boardIcon;
		if (!isIconId(icon)) throw new Error(t("error.unknownIcon", { name: icon }));
		await this.updateSettings({ boardName: name, boardIcon: icon });
	}

	async setLanguagePreference(language: LanguagePreference): Promise<void> {
		await this.updateSettings({ language });
	}

	async updateSettings(patch: Partial<ParanoidTasksSettings>): Promise<void> {
		this.settings = { ...this.settings, ...patch };
		await this.saveData(this.settings);
		if (patch.language !== undefined) this.applyLanguage();
		if (patch.language !== undefined || patch.boardName !== undefined || patch.boardIcon !== undefined) {
			this.updateBoardChrome();
		}
		this.refreshBoards();
	}

	private applyLanguage(): void {
		setLanguage(this.settings.language === "auto" ? obsidianLanguage() : this.settings.language);
	}

	/** Updates the ribbon icon/tooltip and the headers of open board tabs. */
	private updateBoardChrome(): void {
		if (this.ribbonEl) {
			setIcon(this.ribbonEl, this.settings.boardIcon);
			this.ribbonEl.setAttr("aria-label", this.boardTitle());
		}
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_BOARD)) {
			// Not in the public API; without it the tab header updates after reopening the board.
			(leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
		}
	}

	/** Keeps [Details: [[...]]] links in Main.md pointing to a details note after it is renamed or moved. */
	private async onFileRenamed(file: TAbstractFile, oldPath: string): Promise<void> {
		if (!(file instanceof TFile) || file.extension !== "md" || !/\.md$/i.test(oldPath)) return;
		if (file.path === taskFilePath() || oldPath === taskFilePath()) return;
		if (!(this.app.vault.getAbstractFileByPath(taskFilePath()) instanceof TFile)) return;

		// A link may be written as a bare name, a full path or a path relative to Tasks/.
		const oldLink = oldPath.replace(/\.md$/i, "");
		const oldNames = [oldLink.split("/").pop() ?? oldLink, oldLink];
		const folder = taskFolder();
		if (folder && oldLink.startsWith(`${folder}/`)) oldNames.push(oldLink.slice(folder.length + 1));
		const rename = (l: TaskList) => renameDetails(l, oldNames, file.basename, this.settings.detailsFromText);

		try {
			// Skip the write when no task links to the renamed note.
			const list = await readTasks(this.app);
			if (serialize(rename(list)) === serialize(list)) return;
			await updateTasks(this.app, this.columnNames(), rename);
		} catch (e) {
			new Notice(t("notice.error", { message: (e as Error).message }));
		}
	}

	/** Column names in board order; this is what lays out sections in the task file. */
	columnNames(): string[] {
		return this.settings.columns.map((c) => c.name);
	}

	async addColumn(rawName: string): Promise<void> {
		const name = sanitize(rawName);
		assertValid(validateColumnName(name, this.columnNames(), -1));
		await this.applyColumns([...this.settings.columns, newColumn(name)]);
	}

	async renameColumn(index: number, rawName: string): Promise<void> {
		const name = sanitize(rawName);
		const oldName = this.settings.columns[index].name;
		if (name === oldName) return;
		assertValid(validateColumnName(name, this.columnNames(), index));
		const next = this.settings.columns.map((c, i) => (i === index ? { ...c, name } : c));
		await this.applyColumns(next, (l) => renameSection(l, oldName, name));
	}

	/** Deletes a column, moving its tasks to the first remaining one (or a recreated Open). */
	async deleteColumn(index: number): Promise<void> {
		const deleted = this.settings.columns[index].name;
		let next = this.settings.columns.filter((_, i) => i !== index);
		if (next.length === 0) next = [newColumn(DEFAULT_COLUMN)];
		await this.applyColumns(next, (l) => mergeSection(l, deleted, next[0].name));
	}

	/** Changes per-column board options (not the name). */
	async updateColumn(index: number, patch: Partial<Omit<ColumnConfig, "name">>): Promise<void> {
		this.settings.columns = this.settings.columns.map((c, i) => (i === index ? { ...c, ...patch } : c));
		await this.saveData(this.settings);
		this.refreshBoards();
	}

	async moveColumn(index: number, delta: number): Promise<void> {
		const target = index + delta;
		const next = [...this.settings.columns];
		if (target < 0 || target >= next.length) return;
		[next[index], next[target]] = [next[target], next[index]];
		await this.applyColumns(next);
	}

	/** Moves a column to insertion position `to`, counted before the column is removed from its place. */
	async moveColumnTo(from: number, to: number): Promise<void> {
		const next = [...this.settings.columns];
		const [column] = next.splice(from, 1);
		const insertAt = from < to ? to - 1 : to;
		if (insertAt === from) return;
		next.splice(insertAt, 0, column);
		await this.applyColumns(next);
	}

	async setColumnDrag(enabled: boolean): Promise<void> {
		this.settings.columnDrag = enabled;
		await this.saveData(this.settings);
		this.refreshBoards();
	}

	async setCollapsed(column: string, collapsed: boolean): Promise<void> {
		const index = this.settings.columns.findIndex((c) => c.name === column);
		if (index !== -1) await this.updateColumn(index, { collapsed });
	}

	async addPriority(rawName: string): Promise<void> {
		const name = sanitize(rawName);
		const priorities = this.settings.priorities;
		assertValid(validatePriorityName(name, priorities.map((p) => p.name), -1));
		await this.savePriorities([...priorities, { name, symbol: "●", color: "#888888" }]);
	}

	/** Renames a priority; tags in Main.md are rewritten unless it is the default (untagged) one. */
	async renamePriority(index: number, rawName: string): Promise<void> {
		const name = sanitize(rawName);
		const priorities = this.settings.priorities;
		const oldName = priorities[index].name;
		if (name === oldName) return;
		assertValid(validatePriorityName(name, priorities.map((p) => p.name), index));
		if (index > 0) await updateTasks(this.app, this.columnNames(), (l) => renamePriorityTags(l, oldName, name));
		await this.savePriorities(priorities.map((p, i) => (i === index ? { ...p, name } : p)));
	}

	/** Deletes a priority; its tasks lose the tag and become default priority. */
	async deletePriority(index: number): Promise<void> {
		if (index === 0) return;
		const priorities = this.settings.priorities;
		const name = priorities[index].name;
		await updateTasks(this.app, this.columnNames(), (l) => clearPriority(l, name));
		await this.savePriorities(priorities.filter((_, i) => i !== index));
	}

	/** Reorders priorities; the default one always stays first. */
	async movePriority(index: number, delta: number): Promise<void> {
		const target = index + delta;
		const next = [...this.settings.priorities];
		if (index < 1 || target < 1 || target >= next.length) return;
		[next[index], next[target]] = [next[target], next[index]];
		await this.savePriorities(next);
	}

	async updatePriority(index: number, patch: Partial<Pick<Priority, "symbol" | "color">>): Promise<void> {
		const next = this.settings.priorities.map((p, i) => (i === index ? { ...p, ...patch } : p));
		if (patch.symbol !== undefined) next[index].symbol = patch.symbol.trim();
		await this.savePriorities(next);
	}

	private async savePriorities(priorities: Priority[]): Promise<void> {
		this.settings.priorities = priorities;
		await this.saveData(this.settings);
		this.refreshBoards();
	}

	/** Rewrites Main.md for the new columns, then saves settings and redraws boards. */
	private async applyColumns(columns: ColumnConfig[], fn?: (list: TaskList) => TaskList): Promise<void> {
		await updateTasks(
			this.app,
			columns.map((c) => c.name),
			fn,
		);
		this.settings.columns = columns;
		await this.saveData(this.settings);
		this.refreshBoards();
	}

	private refreshBoards(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_BOARD)) {
			if (leaf.view instanceof BoardView) void leaf.view.refresh();
		}
	}

	private async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<ParanoidTasksSettings> | null;
		const folder = typeof data?.taskFolder === "string" ? toFolderPath(data.taskFolder) : DEFAULT_SETTINGS.taskFolder;
		const file = (typeof data?.taskFile === "string" && toTaskFileName(data.taskFile)) || DEFAULT_SETTINGS.taskFile;
		setTaskLocation(folder, file);
		this.settings = {
			taskFolder: folder,
			taskFile: file,
			language: loadLanguage(data?.language),
			// "Task board" was the stored default before localization; treat it as "use the default".
			boardName: typeof data?.boardName === "string" && data.boardName !== "Task board" ? sanitize(data.boardName) : "",
			boardIcon:
				typeof data?.boardIcon === "string" && isIconId(data.boardIcon) ? data.boardIcon : DEFAULT_SETTINGS.boardIcon,
			columns: loadColumns(data),
			columnDrag: loadBoolean(data?.columnDrag, DEFAULT_SETTINGS.columnDrag),
			priorities: loadPriorities(data?.priorities),
			detailsFromText: loadBoolean(data?.detailsFromText, DEFAULT_SETTINGS.detailsFromText),
			detailsByDefault: loadBoolean(data?.detailsByDefault, DEFAULT_SETTINGS.detailsByDefault),
			showDetailsIcon: loadBoolean(data?.showDetailsIcon, DEFAULT_SETTINGS.showDetailsIcon),
		};
	}

	private async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_BOARD)[0];
		if (existing) {
			workspace.revealLeaf(existing);
			return;
		}
		const leaf = workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_BOARD, active: true });
		workspace.revealLeaf(leaf);
	}
}

/** Obsidian's UI language mapped to a supported one; English otherwise. */
function obsidianLanguage(): Language {
	// getLanguage() exists since Obsidian 1.8.7; older versions keep the language in localStorage.
	const code = typeof getLanguage === "function" ? getLanguage() : (window.localStorage.getItem("language") ?? "en");
	return LANGUAGES.find((l) => code === l || code.startsWith(`${l}-`)) ?? "en";
}

function loadLanguage(value: unknown): LanguagePreference {
	return value === "auto" || LANGUAGES.includes(value as Language) ? (value as LanguagePreference) : "auto";
}

function assertValid(error: string | null): void {
	if (error) throw new Error(error);
}

/** Whether `id` is a registered icon; Lucide icons may be given with or without the "lucide-" prefix. */
export function isIconId(id: string): boolean {
	const ids = getIconIds();
	return ids.includes(id) || ids.includes(`lucide-${id}`);
}

/** Normalizes a vault folder path; "" (or "/") means the vault root. */
function toFolderPath(raw: string): string {
	const path = normalizePath(raw.trim());
	return path === "/" ? "" : path;
}

/** Task file name without ".md" and characters not allowed in note names. */
function toTaskFileName(raw: string): string {
	return toFileName(raw.trim().replace(/\.md$/i, ""));
}

function loadBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

/** Settings written by versions before per-column options. */
interface LegacyColumnSettings {
	columns?: unknown;
	collapsed?: unknown;
	columnCollapse?: unknown;
	showTaskCount?: unknown;
}

/**
 * Validates columns from data.json, falling back to defaults. Also reads the old
 * format (names + "collapsed" list + global collapse/count toggles).
 */
function loadColumns(data: LegacyColumnSettings | null): ColumnConfig[] {
	const legacyCollapsed = Array.isArray(data?.collapsed) ? data.collapsed : [];
	const legacyCollapsible = loadBoolean(data?.columnCollapse, true);
	const legacyShowCount = loadBoolean(data?.showTaskCount, true);

	const columns: ColumnConfig[] = [];
	for (const raw of Array.isArray(data?.columns) ? data.columns : DEFAULT_SETTINGS.columns) {
		let column: ColumnConfig;
		if (typeof raw === "string") {
			column = {
				name: sanitize(raw),
				collapsible: legacyCollapsible,
				showCount: legacyShowCount,
				collapsed: legacyCollapsed.includes(raw),
			};
		} else if (raw && typeof raw === "object") {
			const c = raw as Partial<ColumnConfig>;
			const defaults = newColumn("");
			column = {
				name: typeof c.name === "string" ? sanitize(c.name) : "",
				collapsible: loadBoolean(c.collapsible, defaults.collapsible),
				showCount: loadBoolean(c.showCount, defaults.showCount),
				collapsed: loadBoolean(c.collapsed, defaults.collapsed),
			};
		} else {
			continue;
		}
		const names = columns.map((x) => x.name);
		if (validateColumnName(column.name, names, -1) === null) columns.push(column);
	}
	return columns.length > 0 ? columns : [newColumn(DEFAULT_COLUMN)];
}

/** Validates priorities from data.json, falling back to defaults. */
function loadPriorities(data: unknown): Priority[] {
	const priorities: Priority[] = [];
	for (const raw of Array.isArray(data) ? data : DEFAULT_SETTINGS.priorities) {
		if (!raw || typeof raw !== "object") continue;
		const p = raw as Partial<Priority>;
		const name = typeof p.name === "string" ? sanitize(p.name) : "";
		if (validatePriorityName(name, priorities.map((x) => x.name), -1) !== null) continue;
		priorities.push({
			name,
			symbol: typeof p.symbol === "string" ? p.symbol : "●",
			color: typeof p.color === "string" ? p.color : "#888888",
		});
	}
	return priorities.length > 0 ? priorities : DEFAULT_SETTINGS.priorities.map((p) => ({ ...p }));
}
