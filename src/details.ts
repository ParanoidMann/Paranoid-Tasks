import { App, TFile } from "obsidian";
import { ensureTaskFile, taskFileName, taskFilePath, taskFolder } from "./taskStore";
import { sameTitle } from "./tasks";

/** Finds the note a details link points to, like Obsidian resolves links in Main.md. */
export function resolveDetails(app: App, name: string): TFile | null {
	return app.metadataCache.getFirstLinkpathDest(name, taskFilePath());
}

/** Path of a details note: new notes go next to the task file, renamed ones stay in their folder. */
export function detailsPath(name: string, current: TFile | null = null): string {
	const folder = current ? (current.parent && !current.parent.isRoot() ? current.parent.path : "") : taskFolder();
	return folder ? `${folder}/${name}.md` : `${name}.md`;
}

/** Throws if `name` cannot be used for a new details note or for renaming `current`. */
export function checkDetailsName(app: App, name: string, current: TFile | null = null): void {
	if (!name) throw new Error("Details name is empty");
	if (sameTitle(name, taskFileName())) throw new Error(`"${name}" is reserved for the task list`);
	const path = detailsPath(name, current);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing && existing !== current) throw new Error(`${path} already exists`);
}

export async function createDetails(app: App, name: string, columns: string[]): Promise<void> {
	checkDetailsName(app, name);
	await ensureTaskFile(app, columns);
	await app.vault.create(detailsPath(name), "");
}

export async function renameDetailsFile(app: App, file: TFile, name: string): Promise<void> {
	checkDetailsName(app, name, file);
	await app.fileManager.renameFile(file, detailsPath(name, file));
}

/** Moves the note to trash according to the user's Obsidian settings. */
export async function trashDetails(app: App, file: TFile): Promise<void> {
	await app.fileManager.trashFile(file);
}

export async function openDetails(app: App, name: string): Promise<void> {
	await app.workspace.openLinkText(name, taskFilePath(), "tab");
}
