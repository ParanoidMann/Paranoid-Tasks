import { describe, expect, it } from "vitest";
import {
	addTask,
	clearSection,
	daysUntil,
	deleteTask,
	clearPriority,
	editTask,
	emptyList,
	escalatePriorities,
	formatTask,
	getItems,
	mergeSection,
	moveTask,
	normalize,
	parse,
	parseTask,
	renameDetails,
	renamePriority,
	renameSection,
	sanitize,
	serialize,
	TaskList,
	validateColumnName,
	validatePriorityName,
	toFileName,
} from "./tasks";

const COLUMNS = ["Open", "Done"];

const sample = `## Open
- a
- b
- c

## Done
- d

## Remove
- e
`;

function items(list: TaskList): Record<string, string[]> {
	return Object.fromEntries(list.sections.map((s) => [s.title, s.items]));
}

describe("parse / serialize", () => {
	it("round-trips the canonical format", () => {
		expect(serialize(normalize(parse(sample), COLUMNS))).toBe(sample);
	});

	it("parses sections and items", () => {
		expect(items(parse(sample))).toEqual({ Open: ["a", "b", "c"], Done: ["d"], Remove: ["e"] });
	});

	it("keeps preamble and unknown sections, accepts CRLF, merges duplicates", () => {
		const list = parse("# Title\r\n\r\n## open\r\n- x\r\n## Notes\r\n- kept\r\n## OPEN\r\n* y\r\n");
		expect(list.preamble).toBe("# Title");
		expect(items(list)).toEqual({ open: ["x", "y"], Notes: ["kept"] });
	});

	it("serializes an empty list with configured columns and Remove", () => {
		expect(serialize(normalize(emptyList(), COLUMNS))).toBe("## Open\n\n## Done\n\n## Remove\n");
	});
});

describe("normalize", () => {
	it("orders configured columns, then other sections, then Remove; uses configured titles", () => {
		const list = parse("## remove\n- r\n## Notes\n- n\n## done\n- d\n");
		const result = normalize(list, ["Doing", "Done"]);
		expect(result.sections.map((s) => s.title)).toEqual(["Doing", "Done", "Notes", "Remove"]);
		expect(getItems(result, "done")).toEqual(["d"]);
		expect(getItems(result, "Remove")).toEqual(["r"]);
	});
});

describe("sanitize", () => {
	it("joins lines into one", () => {
		expect(sanitize("  foo\nbar\r\n\n baz  ")).toBe("foo bar baz");
	});
});

describe("validateColumnName", () => {
	it("rejects empty, reserved and duplicate names", () => {
		expect(validateColumnName("", COLUMNS, -1)).not.toBeNull();
		expect(validateColumnName("remove", COLUMNS, -1)).not.toBeNull();
		expect(validateColumnName("done", COLUMNS, -1)).not.toBeNull();
		expect(validateColumnName("Doing", COLUMNS, -1)).toBeNull();
		// Renaming a column to itself with another case is allowed.
		expect(validateColumnName("done", COLUMNS, 1)).toBeNull();
	});
});

describe("task operations", () => {
	const list = parse(sample);

	it("adds to the end of a section, creating it if needed", () => {
		expect(getItems(addTask(list, "Done", "z"), "Done")).toEqual(["d", "z"]);
		expect(getItems(addTask(list, "Doing", "z"), "Doing")).toEqual(["z"]);
	});

	it("edits by index and falls back to text lookup", () => {
		expect(getItems(editTask(list, "Open", 1, "b", "B"), "Open")).toEqual(["a", "B", "c"]);
		expect(getItems(editTask(list, "Open", 0, "c", "C"), "Open")).toEqual(["a", "b", "C"]);
		expect(editTask(list, "Open", 0, "missing", "X")).toBe(list);
	});

	it("moves between sections", () => {
		const result = moveTask(list, "Open", 1, "b", "Done", 0);
		expect(getItems(result, "Open")).toEqual(["a", "c"]);
		expect(getItems(result, "Done")).toEqual(["b", "d"]);
	});

	it("reorders within a section", () => {
		expect(getItems(moveTask(list, "Open", 0, "a", "Open", 3), "Open")).toEqual(["b", "c", "a"]);
		expect(getItems(moveTask(list, "Open", 0, "a", "Open", 2), "Open")).toEqual(["b", "a", "c"]);
		expect(getItems(moveTask(list, "Open", 2, "c", "Open", 0), "Open")).toEqual(["c", "a", "b"]);
		expect(getItems(moveTask(list, "Open", 1, "b", "Open", 1), "Open")).toEqual(["a", "b", "c"]);
	});

	it("moves to Remove, clamping the index", () => {
		const result = moveTask(list, "Done", 0, "d", "Remove", Number.MAX_SAFE_INTEGER);
		expect(getItems(result, "Done")).toEqual([]);
		expect(getItems(result, "Remove")).toEqual(["e", "d"]);
	});

	it("does not mutate the input", () => {
		moveTask(list, "Open", 0, "a", "Done", 0);
		expect(getItems(list, "Open")).toEqual(["a", "b", "c"]);
	});
});

describe("section operations", () => {
	const list = parse(sample);

	it("renames a section keeping its tasks", () => {
		const result = renameSection(list, "Done", "Finished");
		expect(items(result)).toEqual({ Open: ["a", "b", "c"], Finished: ["d"], Remove: ["e"] });
	});

	it("merges into an existing section on rename", () => {
		const result = renameSection(parse("## Open\n- a\n## Old\n- x\n## Doing\n- y\n"), "Old", "Doing");
		expect(items(result)).toEqual({ Open: ["a"], Doing: ["y", "x"] });
	});

	it("merges a deleted column into another", () => {
		const result = mergeSection(list, "Open", "Done");
		expect(items(result)).toEqual({ Done: ["d", "a", "b", "c"], Remove: ["e"] });
	});

	it("deleting the only column recreates Open with all its tasks", () => {
		const result = normalize(mergeSection(parse("## Todo\n- a\n## Remove\n"), "Todo", "Open"), ["Open"]);
		expect(serialize(result)).toBe("## Open\n- a\n\n## Remove\n");
	});
});

describe("priorities", () => {
	it("parses and formats the priority tag", () => {
		expect(parseTask("plain task")).toEqual({ priority: null, deadline: null, details: null, text: "plain task" });
		expect(parseTask("[Priority: High] urgent")).toEqual({ priority: "High", deadline: null, details: null, text: "urgent" });
		expect(parseTask("[priority:  Very High ]x")).toEqual({ priority: "Very High", deadline: null, details: null, text: "x" });
		expect(parseTask("see [Priority: High] later")).toEqual({
			priority: null,
			deadline: null,
			details: null,
			text: "see [Priority: High] later",
		});
		expect(formatTask({ priority: null, deadline: null, details: null, text: "a" })).toBe("a");
		expect(formatTask({ priority: "High", deadline: null, details: null, text: "a" })).toBe("[Priority: High] a");
	});

	it("survives the Main.md round-trip", () => {
		const list = parse("## Open\n* [Priority: High] Задача с высоким приоритетом\n");
		expect(getItems(list, "Open")).toEqual(["[Priority: High] Задача с высоким приоритетом"]);
		expect(serialize(list)).toBe("## Open\n- [Priority: High] Задача с высоким приоритетом\n");
	});

	const list = parse("## Open\n- [Priority: High] a\n- [Priority: Low] b\n## Remove\n- [priority: high] c\n- d\n");

	it("renames tags in all sections, case-insensitively", () => {
		expect(items(renamePriority(list, "High", "Urgent"))).toEqual({
			Open: ["[Priority: Urgent] a", "[Priority: Low] b"],
			Remove: ["[Priority: Urgent] c", "d"],
		});
	});

	it("clears tags in all sections", () => {
		expect(items(clearPriority(list, "High"))).toEqual({
			Open: ["a", "[Priority: Low] b"],
			Remove: ["c", "d"],
		});
	});

	it("validates priority names", () => {
		const names = ["Normal", "High"];
		expect(validatePriorityName("", names, -1)).not.toBeNull();
		expect(validatePriorityName("high", names, -1)).not.toBeNull();
		expect(validatePriorityName("a]b", names, -1)).not.toBeNull();
		expect(validatePriorityName("Low", names, -1)).toBeNull();
		expect(validatePriorityName("Remove", names, -1)).toBeNull();
	});
});

describe("details", () => {
	it("parses the details tag after or before the priority", () => {
		const expected = { priority: "High", deadline: null, details: "Note", text: "do it" };
		expect(parseTask("[Priority: High] [Details: [[Note]]] do it")).toEqual(expected);
		expect(parseTask("[Details:[[Note]]][Priority: High] do it")).toEqual(expected);
		expect(parseTask("[Details: [[Note]]] do it")).toEqual({ priority: null, deadline: null, details: "Note", text: "do it" });
	});

	it("takes the link target without alias and heading", () => {
		expect(parseTask("[Details: [[Tasks/Note#Part|Alias]]] x").details).toBe("Tasks/Note");
	});

	it("formats the priority tag first and round-trips", () => {
		const line = "[Priority: High] [Details: [[Note]]] do it";
		expect(formatTask({ priority: "High", deadline: null, details: "Note", text: "do it" })).toBe(line);
		expect(formatTask(parseTask(line))).toBe(line);
		expect(formatTask({ priority: null, deadline: null, details: "Note", text: "x" })).toBe("[Details: [[Note]]] x");
	});

	it("keeps details when changing priorities", () => {
		const list = parse("## Open\n- [Priority: High] [Details: [[N]]] a\n");
		expect(getItems(renamePriority(list, "High", "Urgent"), "Open")).toEqual(["[Priority: Urgent] [Details: [[N]]] a"]);
		expect(getItems(clearPriority(list, "High"), "Open")).toEqual(["[Details: [[N]]] a"]);
	});

	const list = parse(
		"## Open\n- [Details: [[Old]]] text\n- [Details: [[tasks/old.md]]] other\n- [Details: [[Another]]] keep\n- plain\n",
	);

	it("renames matching details links", () => {
		expect(getItems(renameDetails(list, ["Old", "Tasks/Old"], "New", false), "Open")).toEqual([
			"[Details: [[New]]] text",
			"[Details: [[New]]] other",
			"[Details: [[Another]]] keep",
			"plain",
		]);
	});

	it("syncs the task text when asked", () => {
		expect(getItems(renameDetails(list, ["old"], "New", true), "Open")[0]).toBe("[Details: [[New]]] New");
	});

	it("makes file names from text", () => {
		expect(toFileName('  a/b: c*d?"e"<f>|g#h^i[j]  ')).toBe("a b c d e f g h i j");
		expect(toFileName("ends with dots...")).toBe("ends with dots");
		expect(toFileName("x".repeat(150))).toHaveLength(100);
		expect(toFileName("/// ")).toBe("");
	});
});

describe("deadlines", () => {
	it("parses the deadline tag in any order and case", () => {
		const expected = { priority: "High", deadline: "2026-10-30", details: "N", text: "x" };
		expect(parseTask("[Priority: High] [Deadline: 2026-10-30] [Details: [[N]]] x")).toEqual(expected);
		expect(parseTask("[Details: [[N]]] [deadline:2026-10-30] [Priority: High] x")).toEqual(expected);
	});

	it("keeps an invalid date in the text", () => {
		expect(parseTask("[Deadline: 2026-13-40] x")).toEqual({
			priority: null,
			deadline: null,
			details: null,
			text: "[Deadline: 2026-13-40] x",
		});
	});

	it("formats tags as priority, deadline, details", () => {
		const line = "[Priority: High] [Deadline: 2026-10-30] [Details: [[N]]] x";
		expect(formatTask({ priority: "High", deadline: "2026-10-30", details: "N", text: "x" })).toBe(line);
		expect(formatTask(parseTask("[Details: [[N]]] [Deadline: 2026-10-30] [Priority: High] x"))).toBe(line);
		expect(formatTask({ priority: null, deadline: "2026-10-30", details: null, text: "x" })).toBe(
			"[Deadline: 2026-10-30] x",
		);
	});

	it("keeps the deadline when changing priorities", () => {
		const list = parse("## Open\n- [Priority: High] [Deadline: 2026-10-30] a\n");
		expect(getItems(clearPriority(list, "High"), "Open")).toEqual(["[Deadline: 2026-10-30] a"]);
	});

	it("counts days across months and years", () => {
		expect(daysUntil("2026-10-22", "2026-10-29")).toBe(7);
		expect(daysUntil("2026-12-30", "2027-01-02")).toBe(3);
		expect(daysUntil("2026-03-01", "2026-02-27")).toBe(-2);
		expect(daysUntil("2026-10-22", "2026-10-22")).toBe(0);
	});

	it("escalates only default-priority tasks within the window", () => {
		const list = parse(
			[
				"## Open",
				"- [Deadline: 2026-10-24] soon",
				"- [Deadline: 2026-10-20] overdue",
				"- [Deadline: 2026-11-30] far",
				"- [Priority: Low] [Deadline: 2026-10-23] own priority",
				"- [Priority: Normal] [Deadline: 2026-10-23] explicit default",
				"- no deadline",
				"## Remove",
				"- [Deadline: 2026-10-23] removed",
			].join("\n"),
		);
		const result = escalatePriorities(list, "2026-10-22", 3, "High", "Normal");
		expect(getItems(result, "Open")).toEqual([
			"[Priority: High] [Deadline: 2026-10-24] soon",
			"[Priority: High] [Deadline: 2026-10-20] overdue",
			"[Deadline: 2026-11-30] far",
			"[Priority: Low] [Deadline: 2026-10-23] own priority",
			"[Priority: High] [Deadline: 2026-10-23] explicit default",
			"no deadline",
		]);
		expect(getItems(result, "Remove")).toEqual(["[Deadline: 2026-10-23] removed"]);
	});
});

describe("deleteTask", () => {
	const list = parse(sample);

	it("deletes by index and falls back to text lookup", () => {
		expect(getItems(deleteTask(list, "Open", 1, "b"), "Open")).toEqual(["a", "c"]);
		expect(getItems(deleteTask(list, "Open", 0, "c"), "Open")).toEqual(["a", "b"]);
	});

	it("leaves the list unchanged when the task is gone", () => {
		expect(deleteTask(list, "Open", 0, "missing")).toBe(list);
		expect(deleteTask(list, "Nope", 0, "a")).toBe(list);
	});
});

describe("clearSection", () => {
	it("empties one section and keeps the others", () => {
		const result = clearSection(parse(sample), "Remove");
		expect(items(result)).toEqual({ Open: ["a", "b", "c"], Done: ["d"], Remove: [] });
	});
});
