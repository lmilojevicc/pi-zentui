import { describe, expect, it } from "vitest";
import {
	joinNonEmpty,
	parseFooterFormat,
	renderFormatSplit,
	stripOrphanSeparators,
} from "../extensions/zentui/footer-format";

describe("parseFooterFormat", () => {
	it("returns empty array for empty string", () => {
		expect(parseFooterFormat("")).toEqual([]);
	});

	it("parses a single variable", () => {
		expect(parseFooterFormat("$cwd")).toEqual([{ kind: "var", name: "cwd" }]);
	});

	it("parses $package and $package_version as package-version vars", () => {
		expect(parseFooterFormat("$package")).toEqual([{ kind: "var", name: "package" }]);
		expect(parseFooterFormat("$package_version")).toEqual([
			{ kind: "var", name: "package_version" },
		]);
	});

	it("parses braced variables", () => {
		const braced = "${" + "git_branch}";
		expect(parseFooterFormat(braced)).toEqual([{ kind: "var", name: "git_branch" }]);
	});

	it("parses text and variables mixed", () => {
		expect(parseFooterFormat("$cwd on $git_branch")).toEqual([
			{ kind: "var", name: "cwd" },
			{ kind: "text", value: " on " },
			{ kind: "var", name: "git_branch" },
		]);
	});

	it("parses the fill token", () => {
		expect(parseFooterFormat("$fill")).toEqual([{ kind: "fill" }]);
	});

	it("preserves literal text exactly including multiple spaces", () => {
		const tokens = parseFooterFormat("$cwd   on   $git_branch");
		expect(tokens).toEqual([
			{ kind: "var", name: "cwd" },
			{ kind: "text", value: "   on   " },
			{ kind: "var", name: "git_branch" },
		]);
	});

	it("preserves leading and trailing text", () => {
		const tokens = parseFooterFormat("prefix $cwd suffix");
		expect(tokens).toEqual([
			{ kind: "text", value: "prefix " },
			{ kind: "var", name: "cwd" },
			{ kind: "text", value: " suffix" },
		]);
	});

	it("treats unknown variable names as var tokens", () => {
		expect(parseFooterFormat("$nope")).toEqual([{ kind: "var", name: "nope" }]);
	});

	it("handles mixed fill, vars, and text", () => {
		expect(parseFooterFormat("$cwd on $git_branch $fill $cost $time")).toEqual([
			{ kind: "var", name: "cwd" },
			{ kind: "text", value: " on " },
			{ kind: "var", name: "git_branch" },
			{ kind: "text", value: " " },
			{ kind: "fill" },
			{ kind: "text", value: " " },
			{ kind: "var", name: "cost" },
			{ kind: "text", value: " " },
			{ kind: "var", name: "time" },
		]);
	});
});

describe("renderFormatSplit", () => {
	const renderVar = (name: string): string => {
		const map: Record<string, string> = {
			cwd: "DIR",
			git_branch: "BRANCH",
			cost: "$0",
			time: "12:00",
			unknown: "",
		};
		return map[name] ?? "";
	};

	it("splits at the first fill token into left and right", () => {
		const tokens = parseFooterFormat("$cwd$fill$cost $time");
		const { left, middle, right } = renderFormatSplit(tokens, renderVar);
		expect(left).toBe("DIR");
		expect(middle).toBe("");
		expect(right).toBe("$0 12:00");
	});

	it("puts everything in left when there is no fill", () => {
		const tokens = parseFooterFormat("$cwd on $git_branch");
		const { left, middle, right } = renderFormatSplit(tokens, renderVar);
		expect(left).toBe("DIR on BRANCH");
		expect(middle).toBe("");
		expect(right).toBe("");
	});

	it("centers content between two fills in the middle zone", () => {
		const tokens = parseFooterFormat("$cwd$fill$cost$fill$time");
		const { left, middle, right } = renderFormatSplit(tokens, renderVar);
		expect(left).toBe("DIR");
		expect(middle).toBe("$0");
		expect(right).toBe("12:00");
	});

	it("ignores fill tokens beyond the first two", () => {
		const tokens = parseFooterFormat("$cwd$fill$cost$fill$time$fill");
		const { left, middle, right } = renderFormatSplit(tokens, renderVar);
		expect(left).toBe("DIR");
		expect(middle).toBe("$0");
		expect(right).toBe("12:00");
	});

	it("renders unknown variables as empty string", () => {
		const tokens = parseFooterFormat("$nope");
		const { left } = renderFormatSplit(tokens, renderVar);
		expect(left).toBe("");
	});

	it("renders literal text verbatim", () => {
		const tokens = parseFooterFormat("hello $cwd world");
		const { left } = renderFormatSplit(tokens, renderVar);
		expect(left).toBe("hello DIR world");
	});

	it("handles empty token list", () => {
		const { left, middle, right } = renderFormatSplit([], renderVar);
		expect(left).toBe("");
		expect(middle).toBe("");
		expect(right).toBe("");
	});

	it("handles fill at the start", () => {
		const tokens = parseFooterFormat("$fill$cost");
		const { left, middle, right } = renderFormatSplit(tokens, renderVar);
		expect(left).toBe("");
		expect(middle).toBe("");
		expect(right).toBe("$0");
	});

	it("handles fill at the end", () => {
		const tokens = parseFooterFormat("$cwd$fill");
		const { left, middle, right } = renderFormatSplit(tokens, renderVar);
		expect(left).toBe("DIR");
		expect(middle).toBe("");
		expect(right).toBe("");
	});
});

describe("conditional groups", () => {
	const renderVar = (name: string): string => {
		const map: Record<string, string> = {
			cwd: "DIR",
			git_branch: "",
			git_status: "[!]",
			cost: "$0",
			runtime: "",
		};
		return map[name] ?? "";
	};

	it("parses group tokens", () => {
		expect(parseFooterFormat("($git_branch)")).toEqual([
			{ kind: "group", tokens: [{ kind: "var", name: "git_branch" }] },
		]);
	});

	it("drops a group when all vars are empty", () => {
		const tokens = parseFooterFormat("($git_branch)");
		expect(renderFormatSplit(tokens, renderVar).left).toBe("");
	});

	it("drops surrounding literals inside an empty group", () => {
		const tokens = parseFooterFormat("($git_branch on )$cwd");
		expect(renderFormatSplit(tokens, renderVar).left).toBe("DIR");
	});

	it("keeps a group when any var is non-empty", () => {
		const tokens = parseFooterFormat("($git_status)");
		expect(renderFormatSplit(tokens, renderVar).left).toBe("[!]");
	});

	it("supports nested groups", () => {
		const tokens = parseFooterFormat("(($git_branch) via $runtime)$cwd");
		expect(renderFormatSplit(tokens, renderVar).left).toBe("DIR");
	});

	it("still splits on fill outside groups", () => {
		const tokens = parseFooterFormat("$cwd$fill($cost)");
		const { left, right } = renderFormatSplit(tokens, renderVar);
		expect(left).toBe("DIR");
		expect(right).toBe("$0");
	});

	it("shows text-only groups", () => {
		const tokens = parseFooterFormat("(literal)$cwd");
		expect(renderFormatSplit(tokens, renderVar).left).toBe("literalDIR");
	});

	it("treats unmatched top-level ) as literal and keeps trailing tokens", () => {
		const tokens = parseFooterFormat("$cwd) $cost");
		expect(tokens).toEqual([
			{ kind: "var", name: "cwd" },
			{ kind: "text", value: ") " },
			{ kind: "var", name: "cost" },
		]);
		expect(renderFormatSplit(tokens, renderVar).left).toBe("DIR) $0");
	});

	it("keeps nested groups working when trailing tokens follow a closed group", () => {
		const tokens = parseFooterFormat("($git_status)$cwd");
		expect(renderFormatSplit(tokens, renderVar).left).toBe("[!]DIR");
	});
});

describe("joinNonEmpty", () => {
	it("joins only non-empty parts", () => {
		expect(joinNonEmpty(["a", "", "b", ""], " | ")).toBe("a | b");
		expect(joinNonEmpty(["", ""], " | ")).toBe("");
		expect(joinNonEmpty(["only"], " | ")).toBe("only");
	});
});

describe("stripOrphanSeparators", () => {
	it("strips leading and trailing plain pipe separators", () => {
		expect(stripOrphanSeparators(" | tokens")).toBe("tokens");
		expect(stripOrphanSeparators("tokens | ")).toBe("tokens");
		expect(stripOrphanSeparators(" | tokens | ")).toBe("tokens");
	});

	it("collapses repeated plain pipe separators", () => {
		// Two themed/plain seps in a row produce " |  | " (space on both sides of each |).
		expect(stripOrphanSeparators("ctx |  | tokens")).toBe("ctx | tokens");
		expect(stripOrphanSeparators(" |  | $0")).toBe("$0");
	});

	it("strips leading/trailing whitespace after empty groups drop", () => {
		expect(stripOrphanSeparators("  DIR")).toBe("DIR");
		expect(stripOrphanSeparators("DIR  ")).toBe("DIR");
		expect(stripOrphanSeparators("   ")).toBe("");
	});

	it("handles ANSI-wrapped themed separators", () => {
		const sep = "\x1b[90m | \x1b[0m";
		expect(stripOrphanSeparators(`${sep}tokens`)).toBe("tokens");
		expect(stripOrphanSeparators(`ctx${sep}${sep}tokens`)).toBe(`ctx${sep}tokens`);
		expect(stripOrphanSeparators(`ctx${sep}tokens${sep}`)).toBe(`ctx${sep}tokens`);
		expect(stripOrphanSeparators(`${sep}tokens${sep}cost`)).toBe(`tokens${sep}cost`);
	});

	it("does not destroy intentional pipes without surrounding spaces", () => {
		expect(stripOrphanSeparators("branch|feature")).toBe("branch|feature");
	});

	it("tidies right-side groups with empty middle metrics", () => {
		const renderVar = (name: string): string => {
			const map: Record<string, string> = {
				context: "",
				tokens: "",
				cost: "$0",
				sep: " | ",
			};
			return map[name] ?? "";
		};
		// Empty content vars drop their groups even when $sep is present.
		const tokens = parseFooterFormat("($context)($sep$tokens)($sep$cost)");
		const raw = renderFormatSplit(tokens, renderVar).left;
		expect(raw).toBe(" | $0");
		expect(stripOrphanSeparators(raw)).toBe("$0");
	});

	it("drops groups whose only non-empty var is $sep", () => {
		const renderVar = (name: string): string => (name === "sep" ? " | " : "");
		const tokens = parseFooterFormat("($sep$tokens)cwd");
		expect(renderFormatSplit(tokens, renderVar).left).toBe("cwd");
	});

	it("preserves themed separators between non-empty parts", () => {
		const sep = "\x1b[90m | \x1b[0m";
		const renderVar = (name: string): string => {
			const map: Record<string, string> = {
				context: "72%",
				tokens: "↑1",
				cost: "$0",
				sep,
			};
			return map[name] ?? "";
		};
		const tokens = parseFooterFormat("($context)($sep$tokens)($sep$cost)");
		const raw = renderFormatSplit(tokens, renderVar).left;
		expect(stripOrphanSeparators(raw)).toBe(`72%${sep}↑1${sep}$0`);
	});
});
