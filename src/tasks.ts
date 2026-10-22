// Pure task-list logic: parsing/serializing Main.md and list operations.
// Must not import "obsidian" so it can be unit-tested.

/** Service section: always present, always last, never shown on the board. */
export const REMOVE_SECTION = "Remove";
/** Column created when the user deletes all columns. */
export const DEFAULT_COLUMN = "Open";

export interface Section {
	title: string;
	items: string[];
}

export interface TaskList {
	/** Text before the first heading, kept as is. */
	preamble: string;
	sections: Section[];
}

export function emptyList(): TaskList {
	return { preamble: "", sections: [] };
}

/** Section titles are matched case-insensitively. */
export function sameTitle(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function findSection(list: TaskList, title: string): Section | undefined {
	return list.sections.find((s) => sameTitle(s.title, title));
}

function getOrCreateSection(list: TaskList, title: string): Section {
	let section = findSection(list, title);
	if (!section) {
		section = { title, items: [] };
		list.sections.push(section);
	}
	return section;
}

export function getItems(list: TaskList, title: string): string[] {
	return findSection(list, title)?.items ?? [];
}

export function parse(text: string): TaskList {
	const list = emptyList();
	const preamble: string[] = [];
	let current: Section | null = null;

	for (const line of text.split(/\r?\n/)) {
		const heading = /^##\s+(.+?)\s*$/.exec(line);
		if (heading) {
			// Duplicate headings are merged into one section.
			current = getOrCreateSection(list, heading[1]);
			continue;
		}
		if (!current) {
			preamble.push(line);
			continue;
		}
		const item = /^\s*[-*+]\s+(.*)$/.exec(line);
		if (item && item[1].trim()) {
			current.items.push(item[1].trim());
		}
	}

	list.preamble = preamble.join("\n").trim();
	return list;
}

/**
 * Orders sections as: configured columns (created if missing, titles taken
 * from settings), other sections found in the file, then Remove.
 */
export function normalize(list: TaskList, columns: string[]): TaskList {
	const sections: Section[] = columns.map((title) => ({ title, items: [...getItems(list, title)] }));
	for (const section of list.sections) {
		if (sameTitle(section.title, REMOVE_SECTION)) continue;
		if (columns.some((c) => sameTitle(c, section.title))) continue;
		sections.push({ title: section.title, items: [...section.items] });
	}
	sections.push({ title: REMOVE_SECTION, items: [...getItems(list, REMOVE_SECTION)] });
	return { preamble: list.preamble, sections };
}

export function serialize(list: TaskList): string {
	const blocks = list.sections.map((section) => {
		const lines = [`## ${section.title}`];
		for (const text of section.items) lines.push(`- ${text}`);
		return lines.join("\n");
	});
	if (list.preamble) blocks.unshift(list.preamble);
	return blocks.join("\n\n") + "\n";
}

/** Collapses the text into a single trimmed line. */
export function sanitize(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Common name check: non-empty and unique (case-insensitive) except for the item at `index`. */
function validateName(kind: string, name: string, names: string[], index: number): string | null {
	if (!name) return `${kind} name is empty`;
	if (names.some((n, i) => i !== index && sameTitle(n, name))) return `${kind} "${name}" already exists`;
	return null;
}

/** Returns an error message, or null if `name` is a valid new name for column `index` (-1 for a new column). */
export function validateColumnName(name: string, columns: string[], index: number): string | null {
	if (sameTitle(name, REMOVE_SECTION)) return `"${REMOVE_SECTION}" is reserved`;
	return validateName("Column", name, columns, index);
}

/** Returns an error message, or null if `name` is a valid new name for priority `index` (-1 for a new one). */
export function validatePriorityName(name: string, priorities: string[], index: number): string | null {
	if (/[[\]]/.test(name)) return "Priority name cannot contain brackets";
	return validateName("Priority", name, priorities, index);
}

const PRIORITY_TAG = /^\[Priority:\s*([^\]]+?)\s*\]\s*/i;
const DETAILS_TAG = /^\[Details:\s*\[\[([^\]]+?)\]\]\s*\]\s*/i;

export interface ParsedTask {
	/** Priority from the tag, or null if the line has no tag. */
	priority: string | null;
	/** Link target of the details note from `[Details: [[X]]]`, or null. */
	details: string | null;
	text: string;
}

/** Link target without alias (`|...`) and heading/block (`#...`) parts. */
function linkTarget(link: string): string {
	return link.split("|")[0].split("#")[0].trim();
}

/** Splits a task line into its leading tags (in any order) and the text. */
export function parseTask(raw: string): ParsedTask {
	const task: ParsedTask = { priority: null, details: null, text: raw };
	for (;;) {
		const priority = task.priority === null ? PRIORITY_TAG.exec(task.text) : null;
		if (priority) {
			task.priority = priority[1];
			task.text = task.text.slice(priority[0].length);
			continue;
		}
		const details = task.details === null ? DETAILS_TAG.exec(task.text) : null;
		if (details) {
			task.details = linkTarget(details[1]);
			task.text = task.text.slice(details[0].length);
			continue;
		}
		return task;
	}
}

/** Builds a task line: priority tag, details tag, text. Null parts are omitted. */
export function formatTask(task: ParsedTask): string {
	const parts: string[] = [];
	if (task.priority) parts.push(`[Priority: ${task.priority}]`);
	if (task.details) parts.push(`[Details: [[${task.details}]]]`);
	parts.push(task.text);
	return parts.join(" ");
}

/** Makes a note name from arbitrary text; returns "" if nothing usable is left. */
export function toFileName(text: string): string {
	return text
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 100)
		.replace(/[\s.]+$/, "");
}

function mapItems(list: TaskList, fn: (raw: string) => string): TaskList {
	return {
		preamble: list.preamble,
		sections: list.sections.map((s) => ({ title: s.title, items: s.items.map(fn) })),
	};
}

/** Replaces the `oldName` tag with `newName` in all sections. */
export function renamePriority(list: TaskList, oldName: string, newName: string): TaskList {
	return mapItems(list, (raw) => {
		const task = parseTask(raw);
		return task.priority && sameTitle(task.priority, oldName) ? formatTask({ ...task, priority: newName }) : raw;
	});
}

/** Removes the `name` tag in all sections, making those tasks default priority. */
export function clearPriority(list: TaskList, name: string): TaskList {
	return mapItems(list, (raw) => {
		const task = parseTask(raw);
		return task.priority && sameTitle(task.priority, name) ? formatTask({ ...task, priority: null }) : raw;
	});
}

/**
 * Points details links that match any of `oldNames` (case-insensitive,
 * ".md" optional) to `newName`. With `syncText`, the task text becomes `newName` too.
 */
export function renameDetails(list: TaskList, oldNames: string[], newName: string, syncText: boolean): TaskList {
	const matches = (target: string) => {
		const name = target.replace(/\.md$/i, "");
		return oldNames.some((old) => sameTitle(old, name));
	};
	return mapItems(list, (raw) => {
		const task = parseTask(raw);
		if (!task.details || !matches(task.details)) return raw;
		return formatTask({ ...task, details: newName, text: syncText ? newName : task.text });
	});
}

function clone(list: TaskList): TaskList {
	return {
		preamble: list.preamble,
		sections: list.sections.map((s) => ({ title: s.title, items: [...s.items] })),
	};
}

/**
 * Finds the task index, tolerating the file having changed since the board
 * was rendered: if the text at `index` differs, falls back to searching by text.
 */
function locate(items: string[], index: number, text: string): number {
	if (items[index] === text) return index;
	return items.indexOf(text);
}

export function addTask(list: TaskList, section: string, text: string): TaskList {
	const result = clone(list);
	getOrCreateSection(result, section).items.push(text);
	return result;
}

export function editTask(
	list: TaskList,
	section: string,
	index: number,
	oldText: string,
	newText: string,
): TaskList {
	const result = clone(list);
	const items = findSection(result, section)?.items;
	const i = items ? locate(items, index, oldText) : -1;
	if (!items || i === -1) return list;
	items[i] = newText;
	return result;
}

/**
 * Moves a task. `toIndex` is the insertion position in the target section as
 * it was displayed before the move (i.e. still containing the dragged task).
 */
export function moveTask(
	list: TaskList,
	from: string,
	fromIndex: number,
	text: string,
	to: string,
	toIndex: number,
): TaskList {
	const result = clone(list);
	const source = findSection(result, from);
	const i = source ? locate(source.items, fromIndex, text) : -1;
	if (!source || i === -1) return list;
	source.items.splice(i, 1);

	const target = getOrCreateSection(result, to);
	let insertAt = toIndex;
	if (source === target && i < insertAt) insertAt -= 1;
	insertAt = Math.max(0, Math.min(insertAt, target.items.length));
	target.items.splice(insertAt, 0, text);
	return result;
}

/** Renames a section; if a section with the new title exists, merges into it. */
export function renameSection(list: TaskList, oldTitle: string, newTitle: string): TaskList {
	const result = clone(list);
	const section = findSection(result, oldTitle);
	if (!section) return result;
	const existing = findSection(result, newTitle);
	if (existing && existing !== section) {
		existing.items.push(...section.items);
		result.sections = result.sections.filter((s) => s !== section);
	} else {
		section.title = newTitle;
	}
	return result;
}

/** Moves all tasks of `from` to the end of `into` and deletes `from`. */
export function mergeSection(list: TaskList, from: string, into: string): TaskList {
	if (sameTitle(from, into)) return list;
	const result = clone(list);
	const section = findSection(result, from);
	if (!section) return result;
	getOrCreateSection(result, into).items.push(...section.items);
	result.sections = result.sections.filter((s) => s !== section);
	return result;
}
