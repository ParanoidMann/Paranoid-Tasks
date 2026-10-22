import { Plugin } from "obsidian";
import { BoardView, VIEW_TYPE_BOARD } from "./BoardView";
import { DEFAULT_SETTINGS, ParanoidTasksSettings, ParanoidTasksSettingTab } from "./settings";
import { DEFAULT_COLUMN, mergeSection, renameSection, sanitize, TaskList, validateColumnName } from "./tasks";
import { updateTasks } from "./taskStore";

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
		await this.applyColumns(next, (l) => renameSection(l, oldName, name));
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

	/** Rewrites Main.md for the new columns, then saves settings and redraws boards. */
	private async applyColumns(columns: string[], fn?: (list: TaskList) => TaskList): Promise<void> {
		await updateTasks(this.app, columns, fn);
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
		const columns: string[] = [];
		for (const raw of Array.isArray(data?.columns) ? data.columns : DEFAULT_SETTINGS.columns) {
			const name = typeof raw === "string" ? sanitize(raw) : "";
			if (validateColumnName(name, columns, -1) === null) columns.push(name);
		}
		this.settings = { columns: columns.length > 0 ? columns : [DEFAULT_COLUMN] };
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
