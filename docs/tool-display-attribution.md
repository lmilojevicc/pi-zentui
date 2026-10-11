# Tool display reference and attribution

Zentui's native Tool display component uses [pi-tool-display 0.5.0](https://github.com/MasuRii/pi-tool-display/tree/91cef7580078371f8dc49a8607222807ad6a424d) as its visual/behavior reference. The mode names, preset selections, compact call/summary wording, adaptive diff presentation thresholds and hashline gutter conventions are adapted from its `types.ts`, `presets.ts`, `tool-overrides.ts`, `diff-presentation.ts`, `diff-renderer.ts`, `write-display-utils.ts` and `pending-diff-preview.ts`. The implementation is local to Zentui; it does not import upstream internals or read/write upstream configuration.

## Adapted source map

- `diff-renderer.ts`: actual split/unified/compact/summary grids, headers, gutters,
  statistics, RGB row/inline backgrounds, syntax and anchor handling, frames and hints.
- `ansi-utils.ts`, `diff-presentation.ts`, `line-width-safety.ts`, `render-utils.ts`,
  `write-display-utils.ts`: actual upstream presentation helpers.
- `tool-presentation.ts`: presentation-only functions extracted from upstream
  `tool-overrides.ts`; no execution/factory/interception/global adapter code.
- `bash-display.ts`: actual upstream frames, elapsed text, shell/timeout labels and
  timing, scoped to the component owner with bounded timers and release/disposal.
- `renderers.ts`/`controller.ts`: rendering-only adaptation to public resolver ownership,
  safe event-observed preimages and native card acquisition; no schema/execute changes.

## MCP extension-path oracle domains

Unchanged `tool-overrides.ts:1156–1180` selects the registered label for direct MCP
calls; automatic decoration at1988–2022 passes that name/label. Explicit custom
MCP overrides at1930–1960 instead select the proxy form. The oracle now exercises
both real extension registration paths with their own config semantics, rather
than using canonical names under an explicit proxy override as evidence for the
automatic domain. Noncanonical gateways retain explicit-proxy coverage. The live
`sandbox_echo` export is not a matched renderer comparison when only the candidate
explicitly overrides it; its explicit-custom presentation remains unchanged.

The public boundary (`core/extensions/types.d.ts`: ToolInfo1542 omits label,
ToolRenderContext347–372 has no definition/label, and ExtensionAPI has no public
getToolDefinition) requires deriving direct labels from the sanitized Pi name,
using the public namespace server boundary when available.
MCP naming (`extensions/mcp/tools.js:38–49`) replaces characters and can hash/truncate
long names while the raw label (`:183–197`) is retained upstream, so those labels
may differ; this limitation must not be bypassed with private access.

## User-approved Unicode correction

The pinned implementation can place changed-word background ANSI inside a UTF-16
surrogate pair or a combining/ZWJ grapheme. The user explicitly requested fixing
this defect. The only normal-domain parity exception is snapping those emphasis
spans to whole graphemes. `test/fixtures/tool-display-unicode-reference-patch.json`
is the executable two-edit corrected-reference patch; the adjacent `.patch` is
its human-readable diff. Original upstream files remain unchanged. Generated
fixtures record both original and corrected complete rows for affected vectors,
with exact counts/provenance; unaffected rows remain identical to original.
Tests assert UTF-8 roundtrip, retained glyphs and no isolated surrogates.

The live reference's raw 56-token ANSI palette, truecolor mode and bold/italic/
inverse/toolOutput/toolSuccess samples are asserted before oracle generation.
Headless oracle/replay processes enable the SDK's real Chalk styles so disabled
non-TTY attributes cannot falsely substitute for the live reference.

## Ownership and safety boundaries

Default disabled/native delegates unchanged. Native provenance, stable renderer
identities, explicit ambiguous-Bash consent and exact-name custom consent remain
required. No Thinking/User messages, upstream configuration or execution registration
is installed. New owned rows use upstream default card framing. Existing constructed
edit/custom-self outer shells need public rebuild/reload to restore predecessor
framing; callback/component cleanup and sticky release are still preserved.

Text/image/mixed/empty presentation follows upstream while the host retains complete
results, image blocks, error status, history and model content. Hidden read/search/MCP
modes hide error text even when expanded; Summary/Preview reveals it. Unsupported
shapes still fail open.

Pending/write diffs require live, complete, workspace-only preimages from public
events. No render/history filesystem reads or invented create/overwrite preimages.
Symlink/external/binary/special/unreadable paths remain rejected; reads/projections
are bounded to256KiB, cached at most16entries/1MiB/60seconds and cleared on boundaries.
Text input1MiB, diff source8000lines, generated source4000lines/side, comparison250000
cells, per-line16384characters and pre-wrap materialization limits remain safety
guards. Caps/notices are not claimed to match unsafe unbounded upstream output.

`test/generate-tool-display-parity.mjs` loads unchanged pinned upstream only as a
DEVELOPMENT oracle, aliases it to the same actual public SDK/theme objects, never
executes tools, and writes portable compressed complete ANSI card fixtures. Tests
replay those fixtures without upstream installed paths or runtime dependencies.
No hand-authored approximation is used as the parity expected output.

## Upstream MIT notice

MIT License

Copyright (c) 2026 MasuRii

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Oracle generation verifies every pinned upstream source hash against the checked-in
manifest before importing reference code. Registered raw MCP server/tool labels
and public namespaces are independent fixture metadata, not derived by the
candidate split rule. Row/slot components retain parsed/highlighted work across
unchanged paints and width changes; meaningful config/theme/result/preimage changes
rebuild them. Source bounds helpers are in the leaf bounds module; algorithm
assertions exercise the production engine, with only a thin test fixture adapter.
