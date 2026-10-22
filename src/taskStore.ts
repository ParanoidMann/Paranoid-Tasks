import { App, normalizePath, TFile } from "obsidian";
import { t } from "./i18n";
import { emptyList, normalize, parse, serialize, TaskList } from "./tasks";

export const DEFAULT_TASK_FOLDER = "Tasks";
export const DEFAULT_TASK_FILE = "Main";

/** Where the task list lives; set by the plugin from settings. */
let location = { folder: DEFAULT_TASK_FOLDER, file: DEFAULT_TASK_FILE };

/** `folder` is a vault path ("" for the vault root), `file` a note name without ".md". */
export function setTaskLocation(folder: string, file: string): void {
	location = { folder, file };
}

export function taskFolder(): string {
	return location.folder;
}

export function taskFileName(): string {
	return location.file;
}

export function taskFilePath(): string {
	return normalizePath(location.folder ? `${location.folder}/${location.file}.md` : `${location.file}.md`);
}

/** Returns the task file, creating its folder and the file if they are missing. */
export async function ensureTaskFile(app: App, columns: string[]): Promise<TFile> {
	const path = taskFilePath();
	const folder = taskFolder();
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) return existing;
	if (existing) throw new Error(t("error.notAFile", { path }));

	if (folder && !app.vault.getAbstractFileByPath(folder)) {
		try {
			await app.vault.createFolder(folder);
		} catch (e) {
			// Another call may have created it concurrently.
			if (!app.vault.getAbstractFileByPath(folder)) throw e;
		}
	}
	try {
		return await app.vault.create(path, serialize(normalize(emptyList(), columns)));
	} catch (e) {
		const file = app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) return file;
		throw e;
	}
}

/** Reads tasks without creating the file; a missing file means an empty board. */
export async function readTasks(app: App): Promise<TaskList> {
	const file = app.vault.getAbstractFileByPath(taskFilePath());
	if (!(file instanceof TFile)) return emptyList();
	return parse(await app.vault.read(file));
}

/** Atomically applies `fn` to the task list, laid out for `columns`. */
export async function updateTasks(
	app: App,
	columns: string[],
	fn: (list: TaskList) => TaskList = (list) => list,
): Promise<void> {
	const file = await ensureTaskFile(app, columns);
	await app.vault.process(file, (data) => serialize(normalize(fn(parse(data)), columns)));
}
