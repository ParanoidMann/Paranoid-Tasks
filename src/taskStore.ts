import { App, TFile } from "obsidian";
import { emptyList, normalize, parse, serialize, TaskList } from "./tasks";

export const TASK_FOLDER = "Tasks";
export const TASK_FILE_PATH = `${TASK_FOLDER}/Main.md`;

/** Returns Tasks/Main.md, creating the folder and file if they are missing. */
export async function ensureTaskFile(app: App, columns: string[]): Promise<TFile> {
	const existing = app.vault.getAbstractFileByPath(TASK_FILE_PATH);
	if (existing instanceof TFile) return existing;
	if (existing) throw new Error(`${TASK_FILE_PATH} exists but is not a file`);

	if (!app.vault.getAbstractFileByPath(TASK_FOLDER)) {
		try {
			await app.vault.createFolder(TASK_FOLDER);
		} catch (e) {
			// Another call may have created it concurrently.
			if (!app.vault.getAbstractFileByPath(TASK_FOLDER)) throw e;
		}
	}
	try {
		return await app.vault.create(TASK_FILE_PATH, serialize(normalize(emptyList(), columns)));
	} catch (e) {
		const file = app.vault.getAbstractFileByPath(TASK_FILE_PATH);
		if (file instanceof TFile) return file;
		throw e;
	}
}

/** Reads tasks without creating the file; a missing file means an empty board. */
export async function readTasks(app: App): Promise<TaskList> {
	const file = app.vault.getAbstractFileByPath(TASK_FILE_PATH);
	if (!(file instanceof TFile)) return emptyList();
	return parse(await app.vault.read(file));
}

/** Atomically applies `fn` to the task list stored in Main.md, laid out for `columns`. */
export async function updateTasks(
	app: App,
	columns: string[],
	fn: (list: TaskList) => TaskList = (list) => list,
): Promise<void> {
	const file = await ensureTaskFile(app, columns);
	await app.vault.process(file, (data) => serialize(normalize(fn(parse(data)), columns)));
}
