import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Container, VStack } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import {
	type AccentRailLayoutPatchInstallation,
	adjustAccentRailLayoutNode,
	discoverAccentRailLayoutPatchTargetFromEntrypoint,
	installAccentRailLayoutPatchOnTarget,
	markAccentRailLayoutEditor,
	retainAccentRailLayoutPatchInstallation,
	ZENTUI_ACCENT_RAIL_LAYOUT_EDITOR,
} from "../extensions/zentui/accent-rail-layout-patch";
import { SessionLifecycle } from "../extensions/zentui/session-lifecycle";

const LAYOUT_NODE = Symbol.for("@earendil-works/pi-tui/layout-node");
const localPiTuiEntry = createRequire(import.meta.url).resolve("@earendil-works/pi-tui");
const localPiTuiVersion = (
	JSON.parse(readFileSync(join(dirname(localPiTuiEntry), "../package.json"), "utf8")) as {
		version: string;
	}
).version;
const localSupportsAccentRailPatch = /^0\.84\.\d+$/.test(localPiTuiVersion);
const optedInGlobalPi = process.env.ZENTUI_TEST_GLOBAL_PI;

type Entry = {
	component: unknown;
	shrink?: number;
	minSize?: number;
};
type LayoutMethod = (this: unknown, ...args: unknown[]) => unknown;

function markedContainer(
	owner: symbol,
	active: () => boolean = () => true,
	rendered: string[] = ["rail"],
) {
	const editor = { render: () => rendered };
	const invalidate = vi.fn();
	const container = {
		children: [editor],
		render: vi.fn(() => rendered),
		invalidate,
	};
	expect(markAccentRailLayoutEditor(editor, owner, active)).toBe(true);
	return { editor, container, invalidate };
}

function makeFakeVStack(method = LAYOUT_NODE) {
	class FakeVStack {
		entries: Entry[] = [];
		layoutType = "vstack";
		gap = 0;
		align = "stretch";
		render = vi.fn(() => ["first", "", "third"]);
	}
	Object.defineProperty(FakeVStack.prototype, method, {
		value(this: FakeVStack) {
			return {
				type: this.layoutType,
				entries: this.entries,
				gap: this.gap,
				align: this.align,
			};
		},
		configurable: true,
		writable: true,
	});
	return FakeVStack;
}

function installFake(version = "0.84.0", method = LAYOUT_NODE) {
	const FakeVStack = makeFakeVStack(method);
	const owner = Symbol("owner");
	const before = Object.getOwnPropertyDescriptor(FakeVStack.prototype, method);
	const installation = installAccentRailLayoutPatchOnTarget(
		{ prototype: FakeVStack.prototype, version },
		owner,
	);
	return { FakeVStack, owner, before, installation, method };
}

describe("Accent Rail fullscreen layout patch", () => {
	it("clones one owned active entry with a stable forwarding component", () => {
		const owner = Symbol("owner");
		const { container, invalidate } = markedContainer(owner);
		const untouched = { component: { children: [] }, shrink: 1, minSize: 1 };
		const entries = [untouched, { component: container, shrink: 1, minSize: 3, basis: "auto" }];
		const node = { type: "vstack", entries, gap: 1, align: "stretch" };

		const adjusted = adjustAccentRailLayoutNode(node, new Set([owner])) as typeof node;
		const adjustedAgain = adjustAccentRailLayoutNode(node, new Set([owner])) as typeof node;
		const wrapped = adjusted.entries[1]?.component as { render(): string[]; invalidate(): void };

		expect(adjusted).not.toBe(node);
		expect(adjusted.entries).not.toBe(entries);
		expect(adjusted.entries[0]).toBe(untouched);
		expect(adjusted.entries[1]).toMatchObject({ shrink: 1, minSize: 3, basis: "auto" });
		expect(wrapped).not.toBe(container);
		expect(adjustedAgain.entries[1]?.component).toBe(wrapped);
		expect(wrapped.render()).toEqual(["", "rail"]);
		wrapped.invalidate();
		expect(invalidate).toHaveBeenCalledTimes(1);
		expect(entries[1]).toEqual({
			component: container,
			shrink: 1,
			minSize: 3,
			basis: "auto",
		});
	});

	it.each([
		["Opencode or Minimalist live predicate", (): boolean => false, 1, 3],
		["disabled editor live predicate", (): boolean => false, 1, 3],
		["wrong shrink", (): boolean => true, 0, 3],
		["wrong minimum", (): boolean => true, 1, 2],
	] as const)("leaves %s unchanged", (_label, active, shrink, minSize) => {
		const owner = Symbol("owner");
		const { container } = markedContainer(owner, active);
		const node = {
			type: "vstack",
			entries: [{ component: container, shrink, minSize }],
		};
		expect(adjustAccentRailLayoutNode(node, new Set([owner]))).toBe(node);
	});

	it("leaves native, third-party, and wrapped base editors unmarked", () => {
		const owner = Symbol("owner");
		for (const child of [{}, { render: () => ["native"] }, { render: () => ["third-party"] }]) {
			const node = {
				type: "vstack",
				entries: [{ component: { children: [child] }, shrink: 1, minSize: 3 }],
			};
			expect(adjustAccentRailLayoutNode(node, new Set([owner]))).toBe(node);
		}
	});

	it("fails open for multiple children, multiple matches, malformed nodes, and throwing markers", () => {
		const owner = Symbol("owner");
		const first = markedContainer(owner).container;
		const second = markedContainer(owner).container;
		const multipleChildren = {
			type: "vstack",
			entries: [{ component: { children: [first.children[0], {}] }, shrink: 1, minSize: 3 }],
		};
		const multipleMatches = {
			type: "vstack",
			entries: [
				{ component: first, shrink: 1, minSize: 3 },
				{ component: second, shrink: 1, minSize: 3 },
			],
		};
		const throwing = markedContainer(owner, () => {
			throw new Error("stale lifecycle");
		}).container;
		const throwingNode = {
			type: "vstack",
			entries: [{ component: throwing, shrink: 1, minSize: 3 }],
		};

		expect(adjustAccentRailLayoutNode(multipleChildren, new Set([owner]))).toBe(multipleChildren);
		expect(adjustAccentRailLayoutNode(multipleMatches, new Set([owner]))).toBe(multipleMatches);
		expect(adjustAccentRailLayoutNode(throwingNode, new Set([owner]))).toBe(throwingNode);
		expect(adjustAccentRailLayoutNode(null, new Set([owner]))).toBeNull();
		expect(adjustAccentRailLayoutNode({ type: "hstack", entries: [] }, new Set([owner]))).toEqual({
			type: "hstack",
			entries: [],
		});
	});

	it("marks only the requested outer editor with a non-enumerable own marker", () => {
		const owner = Symbol("owner");
		const outer = {};
		const base = {};
		expect(markAccentRailLayoutEditor(outer, owner, () => true)).toBe(true);
		expect(Object.keys(outer)).not.toContain(String(ZENTUI_ACCENT_RAIL_LAYOUT_EDITOR));
		expect(Object.hasOwn(outer, ZENTUI_ACCENT_RAIL_LAYOUT_EDITOR)).toBe(true);
		expect(Object.hasOwn(base, ZENTUI_ACCENT_RAIL_LAYOUT_EDITOR)).toBe(false);
		expect(markAccentRailLayoutEditor(Object.freeze({}), owner, () => true)).toBe(false);
	});

	it("disposes a delayed installation when its lifecycle generation becomes stale", async () => {
		let resolveInstallation: ((value: AccentRailLayoutPatchInstallation) => void) | undefined;
		const cleanup = vi.fn();
		const retained = vi.fn();
		const lifecycle = new SessionLifecycle();
		const lifecycleGeneration = lifecycle.start();
		let installSerial = 1;
		const capturedSerial = installSerial;
		const pending = retainAccentRailLayoutPatchInstallation(
			() =>
				new Promise((resolve) => {
					resolveInstallation = resolve;
				}),
			() => lifecycle.isCurrent(lifecycleGeneration) && capturedSerial === installSerial,
			retained,
		);
		lifecycle.shutdown();
		installSerial += 1;
		resolveInstallation?.({ cleanup, diagnostic: "installed", version: "0.84.2" });
		expect(await pending).toBe("stale");
		expect(cleanup).toHaveBeenCalledOnce();
		expect(retained).not.toHaveBeenCalled();
	});

	it("retains only the newest delayed installation across a restart race", async () => {
		type Resolver = (value: AccentRailLayoutPatchInstallation) => void;
		let resolveFirst: Resolver | undefined;
		let resolveSecond: Resolver | undefined;
		const lifecycle = new SessionLifecycle();
		const firstGeneration = lifecycle.start();
		let installSerial = 1;
		const firstSerial = installSerial;
		const firstCleanup = vi.fn();
		const secondCleanup = vi.fn();
		const retained: AccentRailLayoutPatchInstallation[] = [];
		const first = retainAccentRailLayoutPatchInstallation(
			() => new Promise((resolve) => (resolveFirst = resolve)),
			() => lifecycle.isCurrent(firstGeneration) && installSerial === firstSerial,
			(installation) => retained.push(installation),
		);
		const secondGeneration = lifecycle.start();
		installSerial += 1;
		const secondSerial = installSerial;
		const second = retainAccentRailLayoutPatchInstallation(
			() => new Promise((resolve) => (resolveSecond = resolve)),
			() => lifecycle.isCurrent(secondGeneration) && installSerial === secondSerial,
			(installation) => retained.push(installation),
		);
		resolveSecond?.({ cleanup: secondCleanup, diagnostic: "reused", version: "0.84.2" });
		expect(await second).toBe("retained");
		resolveFirst?.({ cleanup: firstCleanup, diagnostic: "installed", version: "0.84.2" });
		expect(await first).toBe("stale");
		expect(firstCleanup).toHaveBeenCalledOnce();
		expect(secondCleanup).not.toHaveBeenCalled();
		expect(retained).toHaveLength(1);
		expect(retained[0]?.cleanup).toBe(secondCleanup);
	});

	it("fails open when asynchronous host discovery rejects", async () => {
		const retained = vi.fn();
		expect(
			await retainAccentRailLayoutPatchInstallation(
				async () => {
					throw new Error("host discovery failed");
				},
				() => true,
				retained,
			),
		).toBe("failed");
		expect(retained).not.toHaveBeenCalled();
	});

	it("disposes the installation when retaining its cleanup throws", async () => {
		const cleanup = vi.fn();
		expect(
			await retainAccentRailLayoutPatchInstallation(
				async () => ({ cleanup, diagnostic: "installed", version: "0.84.2" }),
				() => true,
				() => {
					throw new Error("stale cleanup slot");
				},
			),
		).toBe("failed");
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it("responds to live style and enablement predicates without reinstalling", () => {
		const { FakeVStack, owner, installation } = installFake();
		let active = true;
		const stack = new FakeVStack();
		const { container } = markedContainer(owner, () => active);
		stack.entries = [{ component: container, shrink: 1, minSize: 3 }];
		const layout = () =>
			(stack as unknown as Record<symbol, () => { entries: Entry[] }>)[LAYOUT_NODE]?.()?.entries[0];
		expect(layout()?.minSize).toBe(3);
		expect(layout()?.component).not.toBe(container);
		active = false;
		expect(layout()?.component).toBe(container);
		active = true;
		expect(layout()?.component).not.toBe(container);
		installation.cleanup();
	});

	it("patches only the layout-node method and preserves regular rendering and intrinsic rows", () => {
		const { FakeVStack, owner, installation } = installFake();
		const stack = new FakeVStack();
		const { container } = markedContainer(owner);
		stack.entries = [{ component: container, shrink: 1, minSize: 3 }];
		const intrinsicRows = ["rail", "", "multiline", "viewport", "autocomplete"];
		stack.render.mockReturnValue(intrinsicRows);

		const node = (stack as unknown as Record<symbol, () => unknown>)[LAYOUT_NODE]?.() as {
			entries: Entry[];
		};
		const entry = node.entries[0];
		expect(entry).toBeDefined();
		if (!entry) throw new Error("expected patched layout entry");
		expect(entry.minSize).toBe(3);
		expect((entry.component as { render(): string[] }).render()).toEqual(["", "rail"]);
		expect(stack.render()).toBe(intrinsicRows);
		expect(stack.render).toHaveBeenCalledTimes(1);
		installation.cleanup();
	});

	it("moves one-row Accent Rail down while keeping Footer in the final dock row", () => {
		const owner = Symbol("owner");
		const { container } = markedContainer(owner);
		const footer = { render: () => ["footer"] };
		const node = adjustAccentRailLayoutNode(
			{
				type: "vstack",
				entries: [
					{ component: container, shrink: 1, minSize: 3 },
					{ component: footer, shrink: 1, minSize: 1 },
				],
				gap: 0,
			},
			new Set([owner]),
		) as { entries: Entry[] };

		expect(node.entries[0]?.minSize).toBe(3);
		expect(node.entries[0]?.component).not.toBe(container);
		const wrapped = node.entries[0]?.component as { render(): string[] };
		const oneRow = wrapped.render();
		expect(oneRow).toEqual(["", "rail"]);
		const paddedOneRow = [...oneRow];
		while (paddedOneRow.length < 3) paddedOneRow.push("");
		expect([...paddedOneRow, "footer"]).toEqual(["", "rail", "", "footer"]);

		for (const intrinsicRows of [
			[],
			["rail", "autocomplete"],
			["rail", ""],
			["above", "rail"],
			["rail", "below"],
			["rail", "", "multiline"],
		]) {
			container.render.mockReturnValueOnce(intrinsicRows);
			const rendered = wrapped.render();
			expect(rendered).toBe(intrinsicRows);
		}
	});

	it("supports multiple owners and restores the exact predecessor descriptor after the last cleanup", () => {
		const { FakeVStack, before, installation, method } = installFake();
		const secondOwner = Symbol("second-owner");
		const second = installAccentRailLayoutPatchOnTarget(
			{ prototype: FakeVStack.prototype, version: "0.84.2" },
			secondOwner,
		);
		expect(second.diagnostic).toBe("reused");

		installation.cleanup();
		expect(Object.getOwnPropertyDescriptor(FakeVStack.prototype, method)?.value).not.toBe(
			before?.value,
		);
		second.cleanup();
		expect(Object.getOwnPropertyDescriptor(FakeVStack.prototype, method)).toEqual(before);
	});

	it("reference-counts repeated registrations for one owner", () => {
		const { FakeVStack, owner, before, installation, method } = installFake();
		const second = installAccentRailLayoutPatchOnTarget(
			{ prototype: FakeVStack.prototype, version: "0.84.0" },
			owner,
		);
		installation.cleanup();
		expect(Object.getOwnPropertyDescriptor(FakeVStack.prototype, method)?.value).not.toBe(
			before?.value,
		);
		second.cleanup();
		expect(Object.getOwnPropertyDescriptor(FakeVStack.prototype, method)).toEqual(before);
	});

	it("preserves a successor and keeps a later-restored ownerless wrapper inert", () => {
		const { FakeVStack, owner, installation, method } = installFake();
		const secondOwner = Symbol("second-owner");
		const second = installAccentRailLayoutPatchOnTarget(
			{ prototype: FakeVStack.prototype, version: "0.84.2" },
			secondOwner,
		);
		const zentuiWrapper = (FakeVStack.prototype as unknown as Record<symbol, LayoutMethod>)[method];
		const successor = function successorPatch(this: unknown, ...args: unknown[]) {
			return Reflect.apply(zentuiWrapper, this, args);
		};
		Object.defineProperty(FakeVStack.prototype, method, {
			...Object.getOwnPropertyDescriptor(FakeVStack.prototype, method),
			value: successor,
		});

		const displaced = installAccentRailLayoutPatchOnTarget(
			{ prototype: FakeVStack.prototype, version: "0.84.2" },
			Symbol("late-owner"),
		);
		expect(displaced.diagnostic).toBe("displaced");
		installation.cleanup();
		second.cleanup();
		expect((FakeVStack.prototype as unknown as Record<symbol, unknown>)[method]).toBe(successor);

		// Simulate the successor restoring the predecessor it captured during install.
		Object.defineProperty(FakeVStack.prototype, method, {
			...Object.getOwnPropertyDescriptor(FakeVStack.prototype, method),
			value: zentuiWrapper,
		});
		const stack = new FakeVStack();
		const { container } = markedContainer(owner);
		stack.entries = [{ component: container, shrink: 1, minSize: 3 }];
		const restored = (stack as unknown as Record<symbol, () => { entries: Entry[] }>)[method]();
		expect(restored.entries[0]?.component).toBe(container);
	});

	it("does not install for unsupported Pi TUI versions", () => {
		for (const version of ["0.80.5", "0.82.1", "0.85.0", "unknown"]) {
			const { FakeVStack, before, installation, method } = installFake(version);
			expect(installation.diagnostic).toBe("unsupported-version");
			expect(Object.getOwnPropertyDescriptor(FakeVStack.prototype, method)).toEqual(before);
		}
	});

	it("discovers a structurally compatible non-exported layout symbol", () => {
		const alternate = Symbol("alternate-layout-node");
		const { FakeVStack, owner, installation } = installFake("0.84.2", alternate);
		const stack = new FakeVStack();
		stack.entries = [{ component: markedContainer(owner).container, shrink: 1, minSize: 3 }];
		const node = (stack as unknown as Record<symbol, () => unknown>)[alternate]?.() as {
			entries: Entry[];
		};
		expect(installation.diagnostic).toBe("installed");
		const entry = node.entries[0];
		expect(entry).toBeDefined();
		if (!entry) throw new Error("expected alternate layout entry");
		expect(entry.minSize).toBe(3);
		expect((entry.component as { render(): string[] }).render()).toEqual(["", "rail"]);
		installation.cleanup();
	});

	it.skipIf(!localSupportsAccentRailPatch)(
		"patches the checked-in 0.84.x VStack without mutating its entries",
		() => {
			const owner = Symbol("owner");
			const editor = { render: () => ["rail"], invalidate() {} };
			markAccentRailLayoutEditor(editor, owner, () => true);
			const container = new Container();
			container.addChild(editor);
			const stack = new VStack([{ component: container, shrink: 1, minSize: 3 }]);
			const installation = installAccentRailLayoutPatchOnTarget(
				{ prototype: VStack.prototype, version: localPiTuiVersion },
				owner,
			);
			const originalEntry = (stack as unknown as Record<symbol, () => { entries: Entry[] }>)[
				LAYOUT_NODE
			]?.()?.entries[0];
			expect(originalEntry).toBeDefined();
			if (!originalEntry) throw new Error("expected checked-in layout entry");
			expect(originalEntry.minSize).toBe(3);
			expect(originalEntry.component).not.toBe(container);
			expect((originalEntry.component as { render(): string[] }).render()).toEqual(["", "rail"]);
			expect((stack as unknown as { entries: Entry[] }).entries[0]?.minSize).toBe(3);
			installation.cleanup();
		},
	);

	it.skipIf(!localSupportsAccentRailPatch)(
		"discovers the checked-in coding-agent nested host package instance",
		async () => {
			const require = createRequire(import.meta.url);
			const tuiEntry = require.resolve("@earendil-works/pi-tui");
			const entrypoint = join(dirname(tuiEntry), "../../pi-coding-agent/dist/cli.js");
			const target = await discoverAccentRailLayoutPatchTargetFromEntrypoint(entrypoint);
			expect(target?.version).toBe(localPiTuiVersion);
			expect(target?.resolvedModulePath).not.toBe(target?.localModulePath);
			expect(target?.resolvedModulePath).toContain(
				"pi-coding-agent/node_modules/@earendil-works/pi-tui",
			);
			expect(target?.prototype).not.toBe(VStack.prototype);
		},
	);

	it.skipIf(!localSupportsAccentRailPatch)(
		"deduplicates host and local resolution when both canonicalize to one module",
		async () => {
			const fixture = makeHostPackageFixture(true);
			try {
				const target = await discoverAccentRailLayoutPatchTargetFromEntrypoint(fixture.bin);
				expect(target?.version).toBe(localPiTuiVersion);
				expect(target?.resolvedModulePath).toBe(target?.localModulePath);
				expect(target?.resolvedModulePath).toBe(realpathSync(fixture.tuiEntry));
			} finally {
				fixture.cleanup();
			}
		},
	);

	it("canonicalizes an npm-bin symlink and patches only the distinct host VStack", async () => {
		const fixture = makeHostPackageFixture();
		try {
			const target = await discoverAccentRailLayoutPatchTargetFromEntrypoint(fixture.bin);
			expect(target?.canonicalEntrypoint).toBe(realpathSync(fixture.cli));
			expect(target?.resolvedModulePath).toBe(realpathSync(fixture.tuiEntry));
			expect(target?.resolvedModulePath).not.toBe(target?.localModulePath);
			if (typeof VStack === "function") expect(target?.prototype).not.toBe(VStack.prototype);

			const owner = Symbol("host-owner");
			const installation = target ? installAccentRailLayoutPatchOnTarget(target, owner) : undefined;
			expect(installation?.diagnostic).toBe("installed");
			const hostStack = Object.create(target?.prototype ?? null) as Record<PropertyKey, unknown>;
			hostStack.entries = [
				{
					component: markedContainer(owner).container,
					shrink: 1,
					minSize: 3,
				},
			];
			hostStack.layoutType = "vstack";
			hostStack.gap = 0;
			hostStack.align = "stretch";
			const hostNode = (hostStack[LAYOUT_NODE] as () => { entries: Entry[] })();
			const hostEntry = hostNode.entries[0];
			expect(hostEntry).toBeDefined();
			if (!hostEntry) throw new Error("expected host layout entry");
			expect(hostEntry.minSize).toBe(3);
			expect((hostEntry.component as { render(): string[] }).render()).toEqual(["", "rail"]);

			if (typeof VStack === "function" && typeof Container === "function") {
				const localStack = new VStack([{ component: new Container(), shrink: 1, minSize: 3 }]);
				const localNode = (localStack as unknown as Record<symbol, () => { entries: Entry[] }>)[
					LAYOUT_NODE
				]?.();
				expect(localNode.entries[0]?.minSize).toBe(3);
			}

			installation?.cleanup();
			const restoredNode = (hostStack[LAYOUT_NODE] as () => { entries: Entry[] })();
			expect(restoredNode.entries[0]?.minSize).toBe(3);
		} finally {
			fixture.cleanup();
		}
	});

	it("fails open for wrappers, directories, missing paths, and broken symlinks", async () => {
		const root = mkdtempSync(join(tmpdir(), "zentui-layout-invalid-"));
		try {
			const wrapper = join(root, "pi-wrapper.js");
			writeFileSync(wrapper, "console.log('wrapper')\n");
			const broken = join(root, "pi-broken");
			symlinkSync(join(root, "missing-cli.js"), broken);
			expect(await discoverAccentRailLayoutPatchTargetFromEntrypoint(wrapper)).toBeUndefined();
			expect(await discoverAccentRailLayoutPatchTargetFromEntrypoint(root)).toBeUndefined();
			expect(
				await discoverAccentRailLayoutPatchTargetFromEntrypoint(join(root, "missing")),
			).toBeUndefined();
			expect(await discoverAccentRailLayoutPatchTargetFromEntrypoint(broken)).toBeUndefined();
		} finally {
			rmSync(root, { force: true, recursive: true });
		}
	});

	it.skipIf(!optedInGlobalPi)(
		"patches an explicitly selected compatible global Pi 0.84.x host",
		async () => {
			const target = await discoverAccentRailLayoutPatchTargetFromEntrypoint(
				optedInGlobalPi as string,
			);
			expect(target?.version).toMatch(/^0\.84\.\d+$/);
			expect(target?.canonicalEntrypoint).toContain("pi-coding-agent/dist/cli.js");
			if (typeof VStack === "function") expect(target?.prototype).not.toBe(VStack.prototype);
			const owner = Symbol("global-owner");
			const installation = target ? installAccentRailLayoutPatchOnTarget(target, owner) : undefined;
			expect(installation?.diagnostic).toBe("installed");
			const { container } = markedContainer(owner);
			const receiver = Object.create(target?.prototype ?? null) as Record<PropertyKey, unknown>;
			receiver.entries = [{ component: container, shrink: 1, minSize: 3 }];
			receiver.layoutType = "vstack";
			receiver.gap = 0;
			receiver.align = "stretch";
			const node = (receiver[LAYOUT_NODE] as () => { entries: Entry[] })();
			const adjustedComponent = node.entries[0]?.component;
			if (!adjustedComponent) throw new Error("missing adjusted layout component");
			expect(node.entries[0]?.minSize).toBe(3);
			expect(adjustedComponent).not.toBe(container);
			expect((adjustedComponent as { render(): string[] }).render()).toEqual(["", "rail"]);
			if (typeof VStack === "function" && typeof Container === "function") {
				expect(
					(
						new VStack([
							{ component: new Container(), shrink: 1, minSize: 3 },
						]) as unknown as Record<symbol, () => { entries: Entry[] }>
					)[LAYOUT_NODE]?.().entries[0]?.minSize,
				).toBe(3);
			}
			installation?.cleanup();
			const restored = (receiver[LAYOUT_NODE] as () => { entries: Entry[] })();
			const restoredComponent = restored.entries[0]?.component;
			if (!restoredComponent) throw new Error("missing restored layout component");
			expect(restored.entries[0]?.minSize).toBe(3);
			expect(restoredComponent).toBe(container);
			expect((restoredComponent as { render(): string[] }).render()).toEqual(["rail"]);
		},
	);
});

function makeHostPackageFixture(useLocalTui = false): {
	root: string;
	bin: string;
	cli: string;
	tuiEntry: string;
	cleanup: () => void;
} {
	const root = mkdtempSync(join(tmpdir(), "zentui-layout-host-"));
	const codingRoot = join(root, "node_modules/@earendil-works/pi-coding-agent");
	const tuiRoot = join(root, "node_modules/@earendil-works/pi-tui");
	const cli = join(codingRoot, "dist/cli.js");
	const tuiEntry = join(tuiRoot, "index.js");
	let expectedTuiEntry = tuiEntry;
	const bin = join(root, "bin/pi");
	mkdirSync(dirname(cli), { recursive: true });
	mkdirSync(dirname(tuiRoot), { recursive: true });
	mkdirSync(dirname(bin), { recursive: true });
	writeFileSync(
		join(codingRoot, "package.json"),
		JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.84.2", type: "module" }),
	);
	writeFileSync(cli, "export {};\n");
	if (useLocalTui) {
		const localEntry = createRequire(import.meta.url).resolve("@earendil-works/pi-tui");
		const localRoot = join(dirname(localEntry), "..");
		symlinkSync(localRoot, tuiRoot, "dir");
		expectedTuiEntry = localEntry;
	} else {
		mkdirSync(tuiRoot, { recursive: true });
		writeFileSync(
			join(tuiRoot, "package.json"),
			JSON.stringify({
				name: "@earendil-works/pi-tui",
				version: "0.84.2",
				type: "module",
				main: "./index.js",
			}),
		);
		writeFileSync(
			tuiEntry,
			`const layout = Symbol.for("@earendil-works/pi-tui/layout-node");
export class VStack {
  constructor(entries = []) { this.entries = entries; this.layoutType = "vstack"; this.gap = 0; this.align = "stretch"; }
  [layout]() { return { type: this.layoutType, entries: this.entries, gap: this.gap, align: this.align }; }
}
`,
		);
	}
	symlinkSync(cli, bin);
	return {
		root,
		bin,
		cli,
		tuiEntry: expectedTuiEntry,
		cleanup: () => rmSync(root, { force: true, recursive: true }),
	};
}
