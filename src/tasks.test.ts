import { describe, expect, it } from "vitest";
import { addTask, editTask, emptyList, moveTask, parse, sanitize, serialize } from "./tasks";

const sample = `## Open
- a
- b
- c

## Done
- d

## Remove
- e
`;

describe("parse / serialize", () => {
	it("round-trips the canonical format", () => {
		expect(serialize(parse(sample))).toBe(sample);
	});

	it("parses sections and items", () => {
		const list = parse(sample);
		expect(list.sections).toEqual({ open: ["a", "b", "c"], done: ["d"], remove: ["e"] });
	});

	it("keeps preamble, ignores unknown sections, accepts CRLF and any heading case", () => {
		const list = parse("# Title\r\n\r\n## open\r\n- x\r\n## Notes\r\n- ignored\r\n## DONE\r\n* y\r\n");
		expect(list.preamble).toBe("# Title");
		expect(list.sections).toEqual({ open: ["x"], done: ["y"], remove: [] });
	});

	it("serializes an empty list with all sections", () => {
		expect(serialize(emptyList())).toBe("## Open\n\n## Done\n\n## Remove\n");
	});
});

describe("sanitize", () => {
	it("joins lines into one", () => {
		expect(sanitize("  foo\nbar\r\n\n baz  ")).toBe("foo bar baz");
	});
});

describe("operations", () => {
	const list = parse(sample);

	it("adds to the end of a section", () => {
		expect(addTask(list, "done", "z").sections.done).toEqual(["d", "z"]);
	});

	it("edits by index and falls back to text lookup", () => {
		expect(editTask(list, "open", 1, "b", "B").sections.open).toEqual(["a", "B", "c"]);
		expect(editTask(list, "open", 0, "c", "C").sections.open).toEqual(["a", "b", "C"]);
		expect(editTask(list, "open", 0, "missing", "X")).toBe(list);
	});

	it("moves between sections", () => {
		const result = moveTask(list, "open", 1, "b", "done", 0);
		expect(result.sections.open).toEqual(["a", "c"]);
		expect(result.sections.done).toEqual(["b", "d"]);
	});

	it("reorders within a section", () => {
		expect(moveTask(list, "open", 0, "a", "open", 3).sections.open).toEqual(["b", "c", "a"]);
		expect(moveTask(list, "open", 0, "a", "open", 2).sections.open).toEqual(["b", "a", "c"]);
		expect(moveTask(list, "open", 2, "c", "open", 0).sections.open).toEqual(["c", "a", "b"]);
		expect(moveTask(list, "open", 1, "b", "open", 1).sections.open).toEqual(["a", "b", "c"]);
	});

	it("moves to remove, clamping the index", () => {
		const result = moveTask(list, "done", 0, "d", "remove", Number.MAX_SAFE_INTEGER);
		expect(result.sections.done).toEqual([]);
		expect(result.sections.remove).toEqual(["e", "d"]);
	});

	it("does not mutate the input", () => {
		moveTask(list, "open", 0, "a", "done", 0);
		expect(list.sections.open).toEqual(["a", "b", "c"]);
	});
});
