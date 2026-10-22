import { describe, expect, it } from "vitest";
import {
	addTask,
	editTask,
	emptyList,
	getItems,
	mergeSection,
	moveTask,
	normalize,
	parse,
	renameSection,
	sanitize,
	serialize,
	TaskList,
	validateColumnName,
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
