import { normalizePath, Notice, Plugin, TAbstractFile, TFile } from "obsidian";
import { BoardView, VIEW_TYPE_BOARD } from "./BoardView";
import { DEFAULT_SETTINGS, ParanoidTasksSettings, ParanoidTasksSettingTab, Priority } from "./settings";
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

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_BOARD, (leaf) => new BoardView(leaf, this));
		this.addSettingTab(new ParanoidTasksSettingTab(this.app, this));

		this.addRibbonIcon("layout-dashboard", "Open task board", () => void this.activateView());
		this.addCommand({
			id: "open-board",
			name: "Open task board",
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
		if (!file) throw new Error("Task file name is empty");
		if (folder === this.settings.taskFolder && file === this.settings.taskFile) return;

		setTaskLocation(folder, file);
		try {
			await ensureTaskFile(this.app, this.settings.columns);
		} catch (e) {
			setTaskLocation(this.settings.taskFolder, this.settings.taskFile);
			throw e;
		}
		await this.updateSettings({ taskFolder: folder, taskFile: file });
	}

	async updateSettings(patch: Partial<ParanoidTasksSettings>): Promise<void> {
		this.settings = { ...this.settings, ...patch };
		await this.saveData(this.settings);
		this.refreshBoards();
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
			await updateTasks(this.app, this.settings.columns, rename);
		} catch (e) {
			new Notice(`Paranoid Tasks: ${(e as Error).message}`);
		}
	}

	async addColumn(rawName: string): Promise<void> {
		const name = sanitize(rawName);
		const columns = this.settings.columns;
		assertValid(validateColumnName(name, columns, -1));
		await this.applyColumns([...columns, name]);
	}

	async renameColumn(index: number, rawName: string): Promise<void> {
		const name = sanitize(rawName);
		const columns = this.settings.columns;
		const oldName = columns[index];
		if (name === oldName) return;
		assertValid(validateColumnName(name, columns, index));
		const next = columns.map((c, i) => (i === index ? name : c));
		const collapsed = this.settings.collapsed.map((c) => (c === oldName ? name : c));
		await this.applyColumns(next, (l) => renameSection(l, oldName, name), collapsed);
	}

	/** Deletes a column, moving its tasks to the first remaining one (or a recreated Open). */
	async deleteColumn(index: number): Promise<void> {
		const columns = this.settings.columns;
		const deleted = columns[index];
		let next = columns.filter((_, i) => i !== index);
		if (next.length === 0) next = [DEFAULT_COLUMN];
		await this.applyColumns(next, (l) => mergeSection(l, deleted, next[0]));
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
		const others = this.settings.collapsed.filter((c) => c !== column);
		this.settings.collapsed = collapsed ? [...others, column] : others;
		await this.saveData(this.settings);
		this.refreshBoards();
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
		if (index > 0) await updateTasks(this.app, this.settings.columns, (l) => renamePriorityTags(l, oldName, name));
		await this.savePriorities(priorities.map((p, i) => (i === index ? { ...p, name } : p)));
	}

	/** Deletes a priority; its tasks lose the tag and become default priority. */
	async deletePriority(index: number): Promise<void> {
		if (index === 0) return;
		const priorities = this.settings.priorities;
		const name = priorities[index].name;
		await updateTasks(this.app, this.settings.columns, (l) => clearPriority(l, name));
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
	private async applyColumns(
		columns: string[],
		fn?: (list: TaskList) => TaskList,
		collapsed = this.settings.collapsed,
	): Promise<void> {
		await updateTasks(this.app, columns, fn);
		this.settings.columns = columns;
		this.settings.collapsed = collapsed.filter((c) => columns.includes(c));
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
		const columns: string[] = [];
		for (const raw of Array.isArray(data?.columns) ? data.columns : DEFAULT_SETTINGS.columns) {
			const name = typeof raw === "string" ? sanitize(raw) : "";
			if (validateColumnName(name, columns, -1) === null) columns.push(name);
		}
		if (columns.length === 0) columns.push(DEFAULT_COLUMN);
		const collapsed = Array.isArray(data?.collapsed)
			? data.collapsed.filter((c): c is string => typeof c === "string" && columns.includes(c))
			: [];
		const folder = typeof data?.taskFolder === "string" ? toFolderPath(data.taskFolder) : DEFAULT_SETTINGS.taskFolder;
		const file = (typeof data?.taskFile === "string" && toTaskFileName(data.taskFile)) || DEFAULT_SETTINGS.taskFile;
		setTaskLocation(folder, file);
		this.settings = {
			taskFolder: folder,
			taskFile: file,
			columns,
			collapsed,
			columnDrag: loadBoolean(data?.columnDrag, DEFAULT_SETTINGS.columnDrag),
			priorities: loadPriorities(data?.priorities),
			detailsFromText: loadBoolean(data?.detailsFromText, DEFAULT_SETTINGS.detailsFromText),
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

function assertValid(error: string | null): void {
	if (error) throw new Error(error);
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
