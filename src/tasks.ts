// Pure task-list logic: parsing/serializing Main.md and list operations.
// Must not import "obsidian" so it can be unit-tested.

export type Section = "open" | "done" | "remove";

export const SECTIONS: Section[] = ["open", "done", "remove"];

export const SECTION_TITLES: Record<Section, string> = {
	open: "Open",
	done: "Done",
	remove: "Remove",
};

export interface TaskList {
	/** Text before the first heading, kept as is. */
	preamble: string;
	sections: Record<Section, string[]>;
}

export function emptyList(): TaskList {
	return { preamble: "", sections: { open: [], done: [], remove: [] } };
}

function titleToSection(title: string): Section | null {
	const normalized = title.trim().toLowerCase();
	return SECTIONS.find((s) => s === normalized) ?? null;
}

export function parse(text: string): TaskList {
	const list = emptyList();
	const preamble: string[] = [];
	let seenHeading = false;
	let current: Section | null = null;

	for (const line of text.split(/\r?\n/)) {
		const heading = /^##\s+(.+?)\s*$/.exec(line);
		if (heading) {
			seenHeading = true;
			current = titleToSection(heading[1]);
			continue;
		}
		if (!seenHeading) {
			preamble.push(line);
			continue;
		}
		if (!current) continue;
		const item = /^\s*[-*+]\s+(.*)$/.exec(line);
		if (item && item[1].trim()) {
			list.sections[current].push(item[1].trim());
		}
	}

	list.preamble = preamble.join("\n").trim();
	return list;
}

export function serialize(list: TaskList): string {
	const blocks = SECTIONS.map((section) => {
		const lines = [`## ${SECTION_TITLES[section]}`];
		for (const text of list.sections[section]) lines.push(`- ${text}`);
		return lines.join("\n");
	});
	if (list.preamble) blocks.unshift(list.preamble);
	return blocks.join("\n\n") + "\n";
}

/** Collapses the text into a single trimmed line. */
export function sanitize(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function clone(list: TaskList): TaskList {
	return {
		preamble: list.preamble,
		sections: {
			open: [...list.sections.open],
			done: [...list.sections.done],
			remove: [...list.sections.remove],
		},
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

export function addTask(list: TaskList, section: Section, text: string): TaskList {
	const result = clone(list);
	result.sections[section].push(text);
	return result;
}

export function editTask(
	list: TaskList,
	section: Section,
	index: number,
	oldText: string,
	newText: string,
): TaskList {
	const result = clone(list);
	const items = result.sections[section];
	const i = locate(items, index, oldText);
	if (i === -1) return list;
	items[i] = newText;
	return result;
}

/**
 * Moves a task. `toIndex` is the insertion position in the target section as
 * it was displayed before the move (i.e. still containing the dragged task).
 */
export function moveTask(
	list: TaskList,
	from: Section,
	fromIndex: number,
	text: string,
	to: Section,
	toIndex: number,
): TaskList {
	const result = clone(list);
	const source = result.sections[from];
	const i = locate(source, fromIndex, text);
	if (i === -1) return list;
	source.splice(i, 1);

	const target = result.sections[to];
	let insertAt = toIndex;
	if (from === to && i < insertAt) insertAt -= 1;
	insertAt = Math.max(0, Math.min(insertAt, target.length));
	target.splice(insertAt, 0, text);
	return result;
}
