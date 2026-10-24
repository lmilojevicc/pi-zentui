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
explicitly overrides it; its explicit-custom result presentation remains unchanged; owned call arguments now use the inline form.

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
this defect. Within the matched oracle domains above, one declared normal-domain
parity exception is snapping those emphasis spans to whole graphemes. `test/fixtures/tool-display-unicode-reference-patch.json`
is the executable two-edit corrected-reference patch; the adjacent `.patch` is
its human-readable diff. Original upstream files remain unchanged. Generated
fixtures record both original and corrected complete rows for affected vectors,
with exact counts/provenance; unaffected rows remain identical to original.
Tests assert UTF-8 roundtrip, retained glyphs and no isolated surrogates.

The live reference's raw 56-token ANSI palette, truecolor mode and bold/italic/
inverse/toolOutput/toolSuccess samples are asserted before oracle generation.
Headless oracle/replay processes enable the SDK's real Chalk styles so disabled
non-TTY attributes cannot falsely substitute for the live reference. They also
scope a cached truecolor capability (`getCapabilities`/`setCapabilities`) to oracle
rendering, restoring the prior capabilities in `finally` without replacing ambient
capability overrides. Terminal detection can otherwise emit 256color on CI. Replay
loads these APIs only inside the modern-host test; older hosts retain their skips.

## User-approved native-style presentation

The earlier option D count-only and native-style inline MCP looks are superseded.
Owned generic calls still show `sandbox_echo message="hello from real custom tool"`.
MCP calls prefix the same accent target with `` and retain bracketed args in both states:
` zentui_demo/echo [message="hello from real local MCP server"]`. Calls wrap with
two-column hanging continuations, never a width ellipsis. Empty args keep
`(no args)` in both states. Proxy/gateway targets remain unchanged, e.g.
` call demo:echo [args={"message":"hello"}]`; routing keys are omitted because
they already appear in the target. Values retain bounded own-data-only inspection,
escaped controls, quoted strings/raw primitives/compact JSON, and source-cap notices.
No values are masked or redacted. Generic call width truncation is unchanged.

Final collapsed MCP rows show no result text in any mode. Preview/Summary add
Pi's real `• Ctrl+O to expand` only when text output exists. Expanded Preview
shows a blank row, `output:` alone, then every bounded result logical line at the
same margin, with two-column hanging wraps. Expanded Summary shows the nonempty
logical returned-line count under `output:` instead of result text; Hidden shows
nothing even when expanded. Running status, host error/image handling and safety/
backend notices remain intact. Existing presets/custom-entry Summary defaults
are deliberately preserved; Preview is recommended as an explicit MCP selection.
This conservatively resolves the old documented Summary-expands-to-preview
semantics in favour of the owner's requested mode mapping, without rewriting config.

Deliberate differences from OpenCode: their `zentui_demo_echo` naming versus our
Pi `zentui_demo/echo`; their status glyph versus our MCP identifier `` and Pi's existing card status/colors;
their lack of an expand hint versus our `• Ctrl+O to expand`; their unquoted strings
versus our quoting/escaping. Expanded args are not duplicated as their key/value
block, and our `output:` is alone above same-margin result lines.

Successful writes without real preimages show `↳ written` and the call arguments'
content as an addition-only grid. This is not a reconstructed diff and performs
no filesystem reads. Upstream defaults to `↳ created` even for historical
overwrites; `written` is deliberately neutral. Live real-preimage create/overwrite
diffs and bounded/unavailable-content notices remain intact. Grep/find/ls insert
one blank row before visible results; hidden/empty result slots remain empty.

These are explicit divergences from unchanged pi-tool-display 0.5.0. The generator
independently transforms bounded fixture call payloads and search spacing, and
uses the corrected upstream write grid with an explicit `written` header for
no-preimage vectors. It never imports the candidate formatter or copies candidate
rows as expectations. Original upstream expectations are retained as
`upstreamMcpRows`, `upstreamGenericRows`, `upstreamWriteRows`, `upstreamSearchRows`.
The prior native-style MCP expectation is retained as `nativeMcpRows` for the
new `mcpOpenCode` divergence. Its target-only `inlineMcpRows` still audits the
previous single args insertion. The new generator-side transform obtains targets
and Preview content from upstream renderers, independently formats bounded
fixture args, and wraps logical lines through the public TUI wrapper. It never
imports candidate formatting. Earlier divergence counts audit the retained
intermediate expectation; `mcpOpenCode` counts the superseding rows against it.
Original upstream source hashes remain verified.

Across **21366 cases**, provenance records:

| Divergence | Vectors | Rows | Unchanged vectors |
| --- | ---: | ---: | ---: |
| `genericInlineArgs` | 702 | 702 | 20664 |
| `mcpInlineArgs` (retained intermediate) | 2358 | 6345 | 19008 |
| `mcpArgsExpansion` (retained intermediate) | 1134 | 1134 | 20232 |
| `mcpOpenCode` | 2358 | 8274 | 19008 |
| `writeContentWithoutPreimage` | 2808 | 2808 | 18558 |
| `searchResultSeparator` | 702 | 702 | 20664 |
| `unicodeCorrection` | 1998 | 3123 | 19368 |
| `bashSyntaxColorOnly` | 486 | 486 | 20880 |

Search/expanded-args row counts mean inserted rows, not shifted indices. Other
row counts mean changed/added indices (MCP therefore includes shifted result
indices); `mcpOpenCode` also counts removed indices. These domains overlap rather
than summing to case count. Unicode still
records 2268 original malformed rows. The 3240 added no-preimage write vectors
mirror successful existing write grids across widths/layouts/indicators/wrapping;
432 extremely narrow headers truncate identically to upstream and stay undeclared.
The 144 added vectors cover MCP edge inputs at 80/150 columns. Tests audit the
retained intermediate full-ANSI rows, single search/args insertions, new MCP
changed/added/removed counts and write-header-only differences. Every unaffected
vector retains the full-ANSI comparison, including unrelated collapsed calls and
real-preimage writes.

## User-approved Bash syntax foreground colors

`bashSyntax` has two modes over the same owned `$ <command>` row. The default
`semantic` mode uses the package's own lexical tokenizer and palette variant A:
tokens are classified without filesystem, PATH, alias/function or execution
access, and each non-base role is painted with exactly one foreground SGR;
`arg`/`space` stay at the terminal default and adjacent same-role tokens share a
run. The command prefix is rendered separately in muted text and is not part of
the tokenized command. This is the user-approved semantic look; it is not the
host highlighter. `pi` (`Host`) keeps public `highlightCode(display, "bash")`,
retaining all upstream characters, wrapping, prompt/suffix/status/output colors
and backgrounds plus the historical outer accent wrapper.

The independently generated `bashSyntaxColorOnly` domain was captured through the
`pi` highlighter and retains complete original `upstreamBashRows`; its 486
vectors/486 changed rows have identical stripped content, widths and line counts.
It remains the geometry oracle for the semantic mode too, whose rows must match
those stripped bytes, widths and counts. The semantic domain additionally pins its
own palette: for a command with two or more roles, the rendered row must carry the
exact role colors `resolveBashPalette` resolves from that fixture's live theme, so
neither the `pi` highlighter nor an accent-only fallback can satisfy the check. The
recorded rows are the `pi` highlighter's, so `upstreamBashRows` is the semantic
mode's geometry oracle rather than its color oracle. All other 20880
vectors remain byte-identical to the preceding fixture. Full-ANSI replay remains
mandatory for every candidate card.

The public highlighter uses Pi's active theme, as do real tool-render callbacks. This
is an integration constraint, not a promise to honor artificial callback themes.
No global theme mutation occurs. In `pi` mode the session painted cache holds the
host highlighter's rows; after the admission gate an executing or restored row is
admitted on its first render, so spinner ticks hit that cache. Semantic mode uses
the session `bash-display` caches: 2 MiB of packed token offsets and 8 MiB of
painted ANSI, 2048 sampled-eviction entries each, plus a bounded 16-entry transient
cache for pre-execution streaming calls; tokens survive theme/mode revisions while
painted rows are cleared. Both caches throttle admission while they are full: a
first-touch miss is admitted one time in eight (one in 32 during a sequential scan
over rows that were never cached) and a second visit is admitted at once, so a
scan-back keeps a partially warm window instead of flushing it. Ingress
sanitization/source caps run first in both modes. The declared charges (96 B/entry
+ 8 B per token per array, two arrays, + 2 B/command byte; 96 B + 2 B/painted byte)
are deliberate upper bounds and charge 10 MiB in total; they bound the working set
to roughly 2,000 short or ≈950 two-KB painted rows. A full rescan of 1,000 two-KB
rows hits 98%, and older rows are re-highlighted when they scroll back in.

Only foreground SGR with exactly preserved text is accepted. Semantic mode
validates each cache miss with a foreground-strip equality pass (strict SGR
forms, length caps, no SGR inside CRLF) and an exact grapheme-boundary scan for
non-ASCII rows. The painter emits a colour change at a word start and never
directly before whitespace; a run may include the trailing space(s), which keeps
every pi-tui whitespace token free of a directly preceding escape and is what makes
painted rows wrap exactly like the uncolored row. Each run covers its whole word, so
every visible grapheme carries its role colour. Rows over 1,024 characters with more
than 256 tokens drop low-signal roles and stop painting after 96 opening foreground
SGRs plus their resets (≤ 193 SGRs in total); the tail after the budget stays at the
terminal default, so pathological operator or short-flag chains cannot multiply ANSI
spans. Missing,
throwing, oversized or invalid output falls back to the `pi` highlighter and then
to the original accent row. Explicit non-Bash shell paths use that same fallback
(only default, `bash` and `sh` paths opt into Bash grammar). No arbitrary tool
output is highlighted and no ownership/configuration/execution changes are made.

## Ownership and safety boundaries

Default disabled/native delegates unchanged. Native provenance, stable renderer
identities, explicit ambiguous-Bash consent and exact-name custom consent remain
required. Loading the dev entry with `--keep-extensions` also loads an installed
`pi-zentui`, so two copies compete for the same surfaces; render resolvers compose in
load order (the first-loaded is outermost) and only that copy owns the `$` row. No Thinking/User messages, upstream configuration or execution registration
is installed. New owned rows use upstream default card framing. Existing constructed
edit/custom-self outer shells need public rebuild/reload to restore predecessor
framing; callback/component cleanup and sticky release are still preserved.

Text/image/mixed/empty presentation retains upstream handling except the declared
MCP layout/mode changes; the host retains complete results, image blocks, error
status, history and model content. Hidden read/search/MCP
modes hide error text even when expanded; MCP Preview reveals it and MCP Summary
reveals only the nonempty-line count (read/search Summary expansion is unchanged). Unsupported
shapes still fail open.

Pending and true old/new write diffs require live, complete, workspace-only preimages from public
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
No screenshot-derived expected rows are used. Declared divergences use the minimal
Unicode reference patch and the independent generator-side native-style transforms
described above; every other domain is unchanged.

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

Cached result keys compare content length, content/details identities, the first256
text/image block values, and known consumed details fields, without cloning payloads.
String equality work is bounded to the1MiB presentation prefix; changes beyond that
prefix cannot change the capped preview. For inventories over256blocks, every public
result callback refreshes the inner component to pick up uninspected tail mutations,
including when references remain unchanged. Between callbacks, unchanged paints and
width changes retain it; bounded value, config/theme, expansion and preimage changes
still invalidate on paint. Ordinary inventories retain value-aware detection of
same-length in-place text mutations without requiring a callback. Bash timers always
update the current slot target so expansion/config/theme rebuilds preserve
frame/elapsed state instead of updating a detached component.
