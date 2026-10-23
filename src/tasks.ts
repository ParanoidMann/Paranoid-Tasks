// Pure task-list logic: parsing/serializing Main.md and list operations.
// Must not import "obsidian" so it can be unit-tested.
import { t, TranslationKey } from "./i18n";

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
function validateName(
	name: string,
	names: string[],
	index: number,
	emptyKey: TranslationKey,
	existsKey: TranslationKey,
): string | null {
	if (!name) return t(emptyKey);
	if (names.some((n, i) => i !== index && sameTitle(n, name))) return t(existsKey, { name });
	return null;
}

/** Column names laid out in a task file: its section headings in order, without Remove and invalid names. */
export function columnsInList(list: TaskList): string[] {
	const columns: string[] = [];
	for (const { title } of list.sections) {
		const name = sanitize(title);
		if (validateColumnName(name, columns, -1) === null) columns.push(name);
	}
	return columns;
}

/** Returns an error message, or null if `name` is a valid new name for column `index` (-1 for a new column). */
export function validateColumnName(name: string, columns: string[], index: number): string | null {
	if (sameTitle(name, REMOVE_SECTION)) return t("error.reserved", { name: REMOVE_SECTION });
	return validateName(name, columns, index, "error.columnNameEmpty", "error.columnExists");
}

/** Returns an error message, or null if `name` is a valid new name for priority `index` (-1 for a new one). */
export function validatePriorityName(name: string, priorities: string[], index: number): string | null {
	if (/[[\]]/.test(name)) return t("error.priorityBrackets");
	return validateName(name, priorities, index, "error.priorityNameEmpty", "error.priorityExists");
}

const PRIORITY_TAG = /^\[Priority:\s*([^\]]+?)\s*\]\s*/i;
const DETAILS_TAG = /^\[Details:\s*\[\[([^\]]+?)\]\]\s*\]\s*/i;
const DEADLINE_TAG = /^\[Deadline:\s*(\d{4}-\d{2}-\d{2})\s*\]\s*/i;
const REPEAT_TAG = /^\[Repeat:\s*([a-z]+(?:\s+(?:[a-z]+|\d{1,2}))?(?:\s+\d{1,2}:\d{2})?)\s*\]\s*/i;
const DONE_TAG = /^\[Done:\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*\]\s*/i;

export interface ParsedTask {
	/** Priority from the tag, or null if the line has no tag. */
	priority: string | null;
	/** Deadline date (YYYY-MM-DD) from `[Deadline: ...]`, or null. */
	deadline: string | null;
	/** Normalized repeat rule from `[Repeat: ...]` (e.g. "daily 09:00"), or null. */
	repeat: string | null;
	/** When a recurring task was checked off ("YYYY-MM-DD HH:MM"), or null if unchecked. */
	done: string | null;
	/** Link target of the details note from `[Details: [[X]]]`, or null. */
	details: string | null;
	text: string;
}

export const REPEAT_KINDS = ["hourly", "daily", "weekly", "monthly", "yearly"] as const;
export type RepeatKind = (typeof REPEAT_KINDS)[number];

/** Weekday names in "weekly <day> HH:MM", Monday first (index + 1 = ISO weekday). */
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * A repeat rule. With `time`, the period starts at that time instead of
 * midnight: every day ("daily 09:00"), on `weekday` ("weekly wed 09:00", 1 = Monday)
 * or on `day` of the month ("monthly 15 09:00").
 */
export interface RepeatRule {
	kind: RepeatKind;
	/** "HH:MM". */
	time?: string;
	/** ISO weekday 1–7 (Monday = 1), for weekly rules with a time. */
	weekday?: number;
	/** Day of the month 1–31, for monthly rules with a time; clamped to the month's last day. */
	day?: number;
}

/** Parses a repeat rule; null if it is not one of the supported forms. */
export function parseRepeat(rule: string): RepeatRule | null {
	const match = /^([a-z]+)(?:\s+([a-z]+|\d{1,2}))?(?:\s+(\d{1,2}):(\d{2}))?$/i.exec(rule.trim());
	if (!match) return null;
	const [, kindText, anchor, h, min] = match;
	const kind = kindText.toLowerCase() as RepeatKind;
	if (!REPEAT_KINDS.includes(kind)) return null;
	if (h === undefined) return anchor === undefined ? { kind } : null;

	const hours = Number(h);
	const minutes = Number(min);
	if (hours > 23 || minutes > 59) return null;
	const time = `${String(hours).padStart(2, "0")}:${min}`;

	if (kind === "daily" && anchor === undefined) return { kind, time };
	if (kind === "weekly" && anchor !== undefined) {
		const weekday = WEEKDAYS.indexOf(anchor.toLowerCase() as (typeof WEEKDAYS)[number]) + 1;
		return weekday > 0 ? { kind, weekday, time } : null;
	}
	if (kind === "monthly" && anchor !== undefined && /^\d+$/.test(anchor)) {
		const day = Number(anchor);
		return day >= 1 && day <= 31 ? { kind, day, time } : null;
	}
	return null;
}

export function formatRepeat(rule: RepeatRule): string {
	if (!rule.time) return rule.kind;
	if (rule.kind === "weekly" && rule.weekday) return `weekly ${WEEKDAYS[rule.weekday - 1]} ${rule.time}`;
	if (rule.kind === "monthly" && rule.day) return `monthly ${rule.day} ${rule.time}`;
	return `${rule.kind} ${rule.time}`;
}

/** `day` of the month at `hours:minutes`, clamped to the month's last day. */
function dayOfMonth(year: number, month: number, day: number, hours: number, minutes: number): Date {
	const lastDay = new Date(year, month + 1, 0).getDate();
	return new Date(year, month, Math.min(day, lastDay), hours, minutes);
}

/**
 * Start of the current period for a repeat rule, in local time: the hour, the
 * day, the week (Monday) or the month at 00:00, or the year. Rules with a time
 * start at the most recent occurrence of that moment (today's / this week's /
 * this month's if already passed, otherwise the previous one).
 */
export function periodStart(rule: RepeatRule, now: Date): Date {
	const y = now.getFullYear();
	const m = now.getMonth();
	const d = now.getDate();
	// getDay(): 0 = Sunday; weeks start on Monday.
	const monday = d - ((now.getDay() + 6) % 7);
	const [hours, minutes] = (rule.time ?? "00:00").split(":").map(Number);
	switch (rule.kind) {
		case "hourly":
			return new Date(y, m, d, now.getHours());
		case "daily": {
			const today = new Date(y, m, d, hours, minutes);
			return today <= now ? today : new Date(y, m, d - 1, hours, minutes);
		}
		case "weekly": {
			const offset = (rule.weekday ?? 1) - 1;
			const thisWeek = new Date(y, m, monday + offset, hours, minutes);
			return thisWeek <= now ? thisWeek : new Date(y, m, monday + offset - 7, hours, minutes);
		}
		case "monthly": {
			const thisMonth = dayOfMonth(y, m, rule.day ?? 1, hours, minutes);
			return thisMonth <= now ? thisMonth : dayOfMonth(y, m - 1, rule.day ?? 1, hours, minutes);
		}
		case "yearly":
			return new Date(y, 0, 1);
	}
}

/** Local time as "YYYY-MM-DD HH:MM" (the format of the Done tag). */
export function formatDoneTime(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${toISODate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseDoneTime(value: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value);
	if (!match) return null;
	const [, y, mo, d, h, mi] = match.map(Number);
	const date = new Date(y, mo - 1, d, h, mi);
	return date.getMonth() === mo - 1 && date.getDate() === d && h < 24 && mi < 60 ? date : null;
}

/** Day number of a YYYY-MM-DD date, or NaN if it is not a real calendar date. */
function dayNumber(date: string): number {
	const [y, m, d] = date.split("-").map(Number);
	const time = Date.UTC(y, m - 1, d);
	const back = new Date(time);
	if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return NaN;
	return time / 86_400_000;
}

export function isValidDate(date: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(dayNumber(date));
}

/** Whole days from `today` to `deadline` (both YYYY-MM-DD); negative when overdue. */
export function daysUntil(today: string, deadline: string): number {
	return dayNumber(deadline) - dayNumber(today);
}

/** Local date as YYYY-MM-DD. */
export function toISODate(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Link target without alias (`|...`) and heading/block (`#...`) parts. */
function linkTarget(link: string): string {
	return link.split("|")[0].split("#")[0].trim();
}

/** Splits a task line into its leading tags (in any order) and the text. */
export function parseTask(raw: string): ParsedTask {
	const task: ParsedTask = { priority: null, deadline: null, repeat: null, done: null, details: null, text: raw };
	for (;;) {
		const priority = task.priority === null ? PRIORITY_TAG.exec(task.text) : null;
		if (priority) {
			task.priority = priority[1];
			task.text = task.text.slice(priority[0].length);
			continue;
		}
		const deadline = task.deadline === null ? DEADLINE_TAG.exec(task.text) : null;
		if (deadline && isValidDate(deadline[1])) {
			task.deadline = deadline[1];
			task.text = task.text.slice(deadline[0].length);
			continue;
		}
		const repeat = task.repeat === null ? REPEAT_TAG.exec(task.text) : null;
		const repeatRule = repeat ? parseRepeat(repeat[1]) : null;
		if (repeat && repeatRule) {
			task.repeat = formatRepeat(repeatRule);
			task.text = task.text.slice(repeat[0].length);
			continue;
		}
		const done = task.done === null ? DONE_TAG.exec(task.text) : null;
		if (done && parseDoneTime(done[1])) {
			task.done = done[1];
			task.text = task.text.slice(done[0].length);
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

/** Builds a task line: priority, deadline, repeat, done and details tags, then the text. Null parts are omitted. */
export function formatTask(task: ParsedTask): string {
	const parts: string[] = [];
	if (task.priority) parts.push(`[Priority: ${task.priority}]`);
	if (task.deadline) parts.push(`[Deadline: ${task.deadline}]`);
	if (task.repeat) parts.push(`[Repeat: ${task.repeat}]`);
	if (task.done) parts.push(`[Done: ${task.done}]`);
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

/** Unchecks recurring tasks checked before the start of their current period. Tasks in Remove are left alone. */
export function resetRecurring(list: TaskList, now: Date): TaskList {
	return {
		preamble: list.preamble,
		sections: list.sections.map((s) => ({
			title: s.title,
			items: sameTitle(s.title, REMOVE_SECTION)
				? s.items
				: s.items.map((raw) => {
						const task = parseTask(raw);
						const rule = task.repeat ? parseRepeat(task.repeat) : null;
						const checkedAt = task.done ? parseDoneTime(task.done) : null;
						if (!rule || !checkedAt || checkedAt >= periodStart(rule, now)) return raw;
						return formatTask({ ...task, done: null });
					}),
		})),
	};
}

/**
 * Gives `priority` to default-priority tasks whose deadline is at most `days`
 * days after `today` (overdue included). Tasks in Remove are left alone.
 */
export function escalatePriorities(
	list: TaskList,
	today: string,
	days: number,
	priority: string,
	defaultName: string,
): TaskList {
	return {
		preamble: list.preamble,
		sections: list.sections.map((s) => ({
			title: s.title,
			items: sameTitle(s.title, REMOVE_SECTION)
				? s.items
				: s.items.map((raw) => {
						const task = parseTask(raw);
						const isDefault = task.priority === null || sameTitle(task.priority, defaultName);
						if (!isDefault || !task.deadline || daysUntil(today, task.deadline) > days) return raw;
						return formatTask({ ...task, priority });
					}),
		})),
	};
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

/** Removes all tasks from a section (the section itself stays). */
export function clearSection(list: TaskList, section: string): TaskList {
	const result = clone(list);
	const target = findSection(result, section);
	if (target) target.items = [];
	return result;
}

/** Removes a task line from the list entirely. */
export function deleteTask(list: TaskList, section: string, index: number, text: string): TaskList {
	const result = clone(list);
	const items = findSection(result, section)?.items;
	const i = items ? locate(items, index, text) : -1;
	if (!items || i === -1) return list;
	items.splice(i, 1);
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
