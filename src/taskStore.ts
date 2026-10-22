import { App, TFile } from "obsidian";
import { emptyList, parse, serialize, TaskList } from "./tasks";

export const TASK_FOLDER = "Tasks";
export const TASK_FILE_PATH = `${TASK_FOLDER}/Main.md`;

/** Returns Tasks/Main.md, creating the folder and file if they are missing. */
export async function ensureTaskFile(app: App): Promise<TFile> {
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
		return await app.vault.create(TASK_FILE_PATH, serialize(emptyList()));
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

/** Atomically applies `fn` to the task list stored in Main.md. */
export async function updateTasks(app: App, fn: (list: TaskList) => TaskList): Promise<void> {
	const file = await ensureTaskFile(app);
	await app.vault.process(file, (data) => serialize(fn(parse(data))));
}
