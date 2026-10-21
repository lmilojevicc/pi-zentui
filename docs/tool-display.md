# Tool display

[Configuration](./configuration.md) · [Attribution](./tool-display-attribution.md)

Zentui's native Tool display is independently opt-in and **disabled by default**.
Open `/zentui tool-display` to configure it. No pi-tool-display installation is
required, no runtime dependency is imported, and its configuration is never read
or written. Enabling Tool display does not enable or restyle Thinking, User
messages, Editor, Working line, or Footer. Tool execution, schemas, activation,
and model-facing prompt metadata remain unchanged.

```json
{
  "components": {
    "toolDisplay": { "enabled": true, "style": "balanced" }
  }
}
```

The host must expose the public `registerToolRenderer(resolver)` API. Capability
status reflects the actual host API, not package directories or install records.
Pi 1.0.3 and 1.0.4 expose this contract; hosts without it keep native/predecessor
rendering. OMP skin-only mode does not expose Tool display
controls and retains saved preferences without applying them.

## Presets and modes

**Preset** offers Native, Opencode, Balanced, and Verbose. Native delegates even
when enabled. Applying another preset selects only its style, output modes, and
preview/Bash line counts; it never enables the component or changes ownership
consent, diff settings, or another surface. Missing modes/counts in hand-written
JSON inherit the selected preset. Explicit values win.

| Preset | Read | Grep/find/ls | Opted-in MCP | Bash | Preview lines | Bash lines |
| --- | --- | --- | --- | --- | --- | --- |
| Opencode | hidden | hidden | hidden | opencode | 8 | 10 |
| Balanced | summary | count | summary | summary | 8 | 10 |
| Verbose | preview | preview | preview | preview | 12 | 20 |

Custom is a derived menu label when these fields differ from their preset; it
is not a saved style or selectable profile. The menu displays nonstandard saved
counts exactly, without rounding them to the nearest offered choice. Any valid
count within the limits below can also be set in JSON.

Read/MCP modes are `hidden | summary | preview`; search modes are
`hidden | count | preview`. Bash `opencode` uses its collapse limit, `summary`
shows a line count, and `preview` shows preview lines. Errors and partial states
follow upstream presentation. Hidden read/search/MCP modes hide result text, including errors, even when expanded; select Preview to reveal MCP text (Summary reveals only its line count). The host retains the actual error status/card color and full result/image data. Unknown result shapes delegate unchanged.
Expansion uses the host's tool expansion action.

Owned generic custom calls show inline arguments, for example:

```text
sandbox_echo message="hello from real custom tool"
```

Owned direct canonical MCP calls prefix the accent label/namespace-derived target with ``,
without an `MCP ` prefix or argument count. Both states keep the same bracketed
argument list. In `preview` mode:

```text
 zentui_demo/echo [message="hello from real local MCP server", repeat=2]
• Ctrl+O to expand
```

Expanded (Ctrl+O):

```text
 zentui_demo/echo [message="hello from real local MCP server", repeat=2]

output:
first result line
second result line
```

Call arguments wrap onto as many rows as needed, with a two-column hanging
indent on continuations; there is no width ellipsis. Each output logical line
starts at the same margin as `output:`; only its wrapped continuations are
hanging-indented by two columns. The expanded call is identical to the collapsed
call, with no separate duplicate `args:` block. Empty arguments keep `(no args)`
in both states. Generic custom calls retain their existing width ellipsis.

The `mcp` proxy and noncanonical MCP gateways keep their existing target selection
(`call demo:echo`, `search "x" @demo`, `describe`, `connect`, `status`). Their calls
use the same bracketed layout, e.g. ` call demo:echo [args={"message":"hello"}]`.
Target-encoded routing keys (`tool`, `server`, `connect`, `describe`, `search`) are
omitted from the payload. Search/describe extras remain visible as `[limit=8]` or
`[verbose=true]`; routing-only calls keep `(no args)` in both states.

### MCP output modes

| MCP mode | Collapsed | Expanded |
| --- | --- | --- |
| `preview` (recommended) | Call args + `• Ctrl+O to expand` when text output exists; no result text | Same call, blank line, `output:` on its own line, then every result line, subject to documented safety/expanded-preview caps |
| `summary` | Call args + the same hint when text output exists; no result text/count | Same call, blank line, `output:`, then `↳ N lines returned` (nonempty logical lines, before wrapping); no result text |
| `hidden` | Call args only, no output hint | Same call; no output, even errors |

An empty Preview expansion shows `output:` followed by `↳ (no output)`; Summary
shows zero lines returned. No hint is added for empty text output or Hidden mode.
Partial/running status, host error colors and images, backend truncation notices
and expanded-preview limits remain intact. `previewLines` does not truncate MCP
arguments or final expanded output; `expandedPreviewMaxLines` still applies.
Generic custom tools and read/search/Bash modes retain their existing semantics.

Existing presets and the omitted custom-entry `summary` default are preserved
conservatively: this changes how MCP modes display, not saved choices. Select an
explicit MCP `outputMode: "preview"` to see returned lines on expansion; Summary
no longer reveals result text even when expanded.

The shared args formatter quotes strings, leaves numbers/booleans/null raw and
uses compact object/array JSON in own-key order; terminal controls are escaped.
Inspection is bounded to 16384 source characters, 256 entries and 16 nesting
levels before serialization; accessors are never invoked. Source-cap ellipses
and safety omission notices remain, unlike width truncation. Values are **not
masked or redacted**, matching native Pi; masking is an explicit non-goal, not a
security promise. Hidden mode still hides results, not call information.

This follows OpenCode's expand-to-see-output behaviour, not its exact details:
OpenCode uses `zentui_demo_echo`; we keep Pi's `zentui_demo/echo`. OpenCode adds a
status glyph; our `` identifies MCP calls, while Pi's card status/colors remain unchanged.
OpenCode has no expand hint; we show Pi's real `• Ctrl+O to expand`.
OpenCode leaves string values unquoted; we keep JSON quoting/escaping. We keep
the bracketed args on expansion rather than duplicate a key/value block, and
place `output:` alone above the same-margin result lines.

Grep/find/ls insert one blank separator between the call and visible result rows,
matching native search spacing; hidden/empty result slots add no blank row.
Inline generic calls, the superseding OpenCode-style MCP layout/output modes,
write wording and search spacing are declared, counted upstream parity divergences. Disabled/native/delegated rows
and unrelated surfaces remain unchanged.

## Preview, diff, and Bash controls

| Field | Default | Accepted values |
| --- | --- | --- |
| `previewLines` | 8 | 1–80 |
| `bashCollapsedLines` | 10 | 0–80 |
| `bashSyntax` | semantic | semantic, pi |
| `expandedPreviewMaxLines` | 4000 | 0–20000; 0 uses the safety cap |
| `diffViewMode` | auto | auto, split, unified |
| `diffIndicatorMode` | bars | bars, classic, none |
| `diffSplitMinWidth` | 120 | 70–240 columns |
| `diffCollapsedLines` | 24 | 4–240 visual rows |
| `diffWordWrap` | true | boolean |
| `showTruncationHints` | false | optional backend truncation hints |

Finite numbers are floored and clamped; invalid values use defaults (preset
counts where applicable). Auto diffs prefer split above the threshold. Narrow
panes fall back to unified, compact, or summary presentation even with split
selected. Diffs use the adapted upstream grids, old/new headers, separators, anchors,
indicator bars, syntax colors, RGB row/changed-word backgrounds and count hints.
They wrap or clip long lines and report omitted hunks or safety truncation. Colors
are derived from the current host theme exactly as upstream; owner-local raw color overrides are not currently supported.

Live write/edit preimages are bounded, workspace-scoped best-effort previews.
Symlinks, external, binary, special, unreadable, or oversized files are rejected.
Historical rendering never reads files to reconstruct an old preimage. When
write preimages are unavailable, `↳ written` precedes an addition-only content
grid (line numbers and configured addition indicators), sourced solely from call
arguments. This is not an old/new diff and never reads files. The neutral
`written` replaces upstream's `created`, which could misleadingly imply a new
file during an overwrite. Real preimages keep the true `created`/`overwritten`
diff. Missing content and oversized inputs retain honest unavailable/omission notices. Preview caches are bounded and cleared across session,
tree, reload, shutdown, and release boundaries. These previews are not a security
sandbox against concurrent filesystem mutation.

Text input is capped at 1 MiB, diff parsing at 8000 lines, generated diffs at
4000 lines per side with bounded comparison work, and expanded text at 20000
logical lines. Before syntax highlighting or wrapping, each diff line is bounded
to 16384 characters and the remaining visual-row budget. Diff layout materializes
at most 8000 visual rows; normal previews also bound wrapping work before creating
rows. Limits are reported instead of silently implying full output. Write call headers and partial counts inspect only bounded numeric metadata,
without normalizing unused content or allocating a full line array. Oversized
labels use explicit lower bounds and a cap notice; normal suffixes stay unchanged.
New and previous write sources and each line are bounded before splitting, highlighting
or detailed diff construction; capped write sources produce an honest omission
notice. Edit input-cap warnings are outside the parsed/collapsed body so they
survive source/render boundaries and unlimited expansion. Ordinary terminal
LF/blank meta rows retain upstream presentation. Omitted-row counts are lower
bounds when unrendered lines could wrap.

Tool text keeps one completed, safety-checked layout per component at its most
recent normalized width. Unchanged paints reuse it and return fresh row arrays.
Text updates (even identical text), changed safety budgets, padding/background
setters, and explicit `invalidate()` clear the cache. Theme-dependent background
callbacks must be invalidated when their captured theme changes. Failed renders
are not cached; safety caps and omission notices remain unchanged.

## Bash command syntax

`bashSyntax` chooses how the `$ <command>` call row is colored. `semantic` (the
default) tokenizes the command lexically and paints commands, builtins, keywords,
strings, numbers, options, paths/globs, variables, operators, redirections and
comments with palette variant A. `pi` (labeled `Host`) keeps the host
`highlightCode(display, "bash")` output, including its historical accent wrapper.
Unknown values fall back to `semantic`; presets never change this choice, and
enabling or changing it never touches another surface or the command's execution.

Semantic highlighting is color-only and foreground-only. The command's prompt
prefix (`$`, `PS>`, `user@host:~$`) is rendered once in muted text and is never
tokenized with the command, so the verb color always lands on the real command.
It never inserts, removes, or reorders visible bytes; plain `arg`/`space` tokens
stay at the terminal default with no SGR. Colour changes are emitted at the start
of a word and never between a word and the whitespace that follows it: pi-tui
attaches an escape that directly precedes a space to that whitespace token, which
turns the space into a zero-width word and shifts wrap boundaries or inserts a
zero-width escape-only row. Keeping every whitespace token escape-free is what
makes painted rows wrap exactly like the uncolored command, and one foreground run
covers one whole whitespace-delimited colored word, so no visible grapheme is left
unpainted. A row that ends while a colour is open closes it after its last byte,
exactly like the `pi` accent wrapper. A host-level `wrapSingleLine` artifact can
still insert a whitespace-only row when a token breaks exactly at the row width;
the legacy accent row produces the same artifact, and the production
`PresentationText` component drops such rows.

Rows over 1,024 characters with more than 256 tokens degrade gracefully:
low-signal tokens (options, numbers, operators, redirections, substitution
delimiters, arithmetic, continuations, here-doc terminators) drop out, and the row
stops painting after 96 SGR spans (48 colored words), so ANSI growth and host
wrapping stay bounded for 12K–16K option-dense input. Ordinary command rows sit far
below both bounds and keep the full palette. Classification is purely lexical: no `PATH`
lookup, no filesystem stat, no alias/function resolution, and no command
execution, so the row never blocks on the host and never reads project files.
Invalid or unavailable painting fails open to the `pi` highlighter, then to the
plain accent row; a theme that resolves no role also fails open instead of
dropping the command color.

Raw SGR sequences already present in the model-supplied command text are
pre-existing host behavior: ingress sanitization keeps `ESC[…m`, the semantic
painter neither escapes nor removes it, and validation compares visible bytes
after stripping only foreground SGR. A raw background/attribute SGR therefore
passes through unchanged, exactly as the `pi` and native rows always did; this
feature neither widens nor closes that host behavior.

Command paint is memoized per progress session: a 2 MiB packed-token cache and an
8 MiB painted-ANSI cache, each capped at 2048 entries, cleared on dispose. Both are
byte-budgeted and evict a sampled entry rather than strictly the oldest, so a
rescan that overruns the window keeps a partially warm one instead of evicting
exactly the row it needs next (a strict LRU rescan misses 100%). While a cache is
full, a row that was never seen is admitted on one miss in eight (one in 32 during
a long miss run, i.e. a sequential scan over rows that were never cached) and a
row that already missed once is admitted immediately, so a scan-back cannot flush
the retained window while the live session keeps entering the cache. Measured on
1,000 distinct 2,000-character commands: the fill costs ≈134 ms, a full second
sequential pass costs ≈6 ms and hits 98% of rows, and re-rendering 300 two-KB rows
re-tokenizes nothing. The retained window follows directly from the charges (96 B
per entry + 16 B per token + 2 B per command byte for tokens; 96 B + 2 B per
painted byte): roughly 2,000 short commands, or ≈950 × 2,000-character commands
for painted rows (a 2 KB row paints to ≈4.2 KB). A theme change clears painted
rows once; tokens survive. It is a working set, not the whole session
history; older rows are highlighted again when they scroll back in. Measured heap
tracks those charges within about 1.5× (a full token cache is ≈1.5 MiB, and the
painted charge is conservative for ASCII), so the pair's real ceiling is ≈5 MiB
rather than an open-ended scroll history. Scroll, resize, and host invalidate
inside that window are cache hits: no tokenize, palette resolution, or validation
runs. A theme revision clears every painted row (they encode colors), so the first
render after a theme change repaints the window from the surviving tokens; the
token cache is small enough that most of those repaints also re-tokenize.
A streaming (not yet committed) call is painted through a one-row transient
cache and is not admitted into either session cache, so a long streamed command
cannot evict completed rows. Cache misses validate foreground-only SGR
(hand-parsed: `39`, `30`–`37`, `90`–`97`, `38;5;N`, `38;2;R;G;B`), exact
strip equality, length caps, and no SGR inside a CRLF pair in one
foreground-strip equality pass; non-ASCII rows add the exact grapheme-boundary
scan, and the whitespace relocation that keeps native wrapping geometry is
opt-in because both owned painters already guarantee no SGR next to
whitespace. Validation runs only on a cache miss. Pi's stable theme proxy is
probed through `theme.colors` identity (falling back to sampling only the tokens
actually used); a theme or mode revision clears painted rows while tokens
survive.

Semantic output is wrapped by the same production `PresentationText` as every
other owned row. Because the painter never leaves an active SGR at a whitespace
token, semantic rows need no filtering at all: raw pi-tui `Text` already produces
row-for-row identical output to the uncolored command at every width (a
10–200-column sweep over agent-typical commands with long options, paths, globs
and URLs is pinned by the test suite). `PresentationText` still drops pi-tui's
escape-only wrap row (a zero-width row a colored line can produce when a space
fills a row exactly and the next token is wider than the row), which the `pi`
highlighter and the plain accent row can still produce; that is a host wrapping
fix, not a semantic-only filter.

On a color-poor theme, a role's candidate color that is already owned by the base
text or a higher-priority role is skipped. Variant A declares no merge groups:
redirect and quiet may borrow the resolved structural color, and otherwise a role
stays unpainted (terminal default) rather than silently repeating another color.
`variable` falls through to `syntaxVariable`/`mdLink`/`syntaxString`/`error` so
builtin light themes keep strings and variables readable (the builtin light theme
resolves no role to terminal default), and here-doc bodies use the literal color
while their terminators stay quiet.

Here-doc bodies and terminators render as one token per line, with quote-aware
delimiters, `$var` delimiters, `<<-` tab stripping, and CRLF-tolerant
terminators; they are never tokenized as commands. `[[ … ]]` comparisons,
`case` patterns, `for ((…))` headers, array literals and wrapper chains
(`sudo … env`, `time nice`, `timeout … xargs`) keep their real command word
armed so the verb color is accurate.

```json
{
  "components": {
    "toolDisplay": { "enabled": true, "bashSyntax": "semantic" }
  }
}
```

## Ownership and advanced JSON

`registerToolOverrides` contains independent eligibility booleans for `read`,
`write`, `edit`, `bash`, `grep`, `find`, and `ls`, all true by default. A false flag
releases only that tool's display. True is not permission to replace a foreign
tool definition or an ambiguous third-party renderer. Native builtin provenance
and public renderer identities must both be verified; unknown provenance fails
open to the predecessor.

`builtinRendererOverrides` is sparse and empty by default. Explicit true permits
rendering-only replacement of an ambiguous renderer **only** while that exact
tool still has verified native builtin execution provenance. Native Bash uses
fresh renderer closures and therefore requires explicit consent to replace its
renderer; the ordinary Bash eligibility flag alone is insufficient. In
`/zentui tool-display`, **Override Bash renderer** defaults off. Enable it only
when intending to replace existing native Bash rendering, not execution. Off
deletes the sparse override and restores conservative delegation. Ordinary
enablement, presets, and Bash eligibility never grant this consent. The same
choice can be set in JSON:

```json
{
  "components": {
    "toolDisplay": {
      "builtinRendererOverrides": { "bash": true }
    }
  }
}
```

This advanced choice may replace another extension's rendering of native Bash.
Switch **Override Bash renderer** off or omit/delete the key to resume conservative delegation. Other builtin renderer-consent flags remain JSON-only. It never authorizes
replacement of foreign execution, parameters, or prompts.

Custom/MCP ownership is **exact-name opt-in**, not wildcard or heuristic matching:

```json
{
  "components": {
    "toolDisplay": {
      "customToolOverrides": {
        "my_lookup": { "enabled": true, "kind": "generic", "outputMode": "summary" },
        "mcp__example__lookup": { "enabled": true, "kind": "mcp" }
      }
    }
  }
}
```

Canonical `mcp__<server>__<tool>` entries use upstream's automatic/direct MCP
presentation (`<server>/<tool>`), even with an explicit custom override. This is
an intentional divergence from upstream's explicit-custom path, which uses proxy
target selection (for example, `MCP status (1 arg)` for `{message}` arguments).
Zentui retains the canonical target (`zentui_demo/echo`) with bracketed payloads, so
opting in does not change the tool's identity. The public ToolInfo API has no
registered label,
so public namespace metadata supplies the server boundary when available; otherwise
the documented Pi naming normalization is used without private inspection.
The shown label comes from the already-sanitized tool name: neither ToolInfo nor
ToolRenderContext provides the raw label, and ExtensionAPI has no public
`getToolDefinition` getter. Replaced characters or hashed/truncated long names therefore
cannot be recovered and may differ from upstream's raw server/tool label; simple
names such as `mcp__zentui_demo__echo` are unaffected.
The builtin `mcp` proxy and noncanonical custom-MCP gateways keep upstream's
proxy target selection (`tool`, `server`, `connect`, `describe`, `search`). This
changes presentation only, never the existing exact-name consent requirement.
Comparisons must match configuration scope: an explicitly styled custom tool
must not be compared as if it were an unlisted reference/native tool.

Unlisted or disabled tools delegate. `kind` is `generic | mcp`; boolean shorthand
is accepted with generic rendering. Omitted or invalid `outputMode` defaults to
summary for both kinds, matching upstream custom entries independently of global
`mcpOutputMode`; explicit hidden/summary/preview wins. Deleting `outputMode`
resumes the summary default. Existing renderers or shells remain owned by
the predecessor unless the exact entry explicitly sets
`overrideExistingRenderers: true`. Use that advanced consent only when intending
to replace that tool's display. Builtin names and prototype names are rejected
in this dictionary. At most 100 entries with names up to 200 characters are
accepted. There are no RTK, package-wide UI, or native user-message-box controls.

## Save and reload behavior

Ordinary settings edits atomically snapshot only the edited Tool display owner
in Zentui's configuration, preserving unrelated and unknown user-owned fields.
Corrupt/unreadable Zentui JSON is not overwritten. Disabled/native preferences
save dormant without taking another surface or touching another package.
`/zentui migrate` remains the separate confirmed all-owner snapshot; it does not
change the summary default for omitted custom output modes or generate colors.

On supported hosts, live mode edits affect rows Zentui still owns. A row that
has delegated to its predecessor stays delegated for its remaining lifetime,
including partial-to-final delivery, to preserve predecessor cleanup. The actual
predecessor call/result components and their invalidation are retained separately;
callbacks run when the host supplies an update, even if the row is not painted.
An owned row's content is rebuilt from those callbacks, not from paint, so a host
that rewrites tool arguments or results in place without a callback is only
repainted, not re-rendered.
Ownership changes take effect on an existing row at its next host callback or
rebuild, not merely on paint. A paint-time preview failure displays a bounded
notice and delegates on the next host update. Newly owned rows acquire the upstream default native card shell. Existing owned
edit/custom-self cards retain their constructed outer shell until public
rebuild/reload; callback cleanup and sticky predecessor delegation still apply.
Initially native rows need recreation/rebuild/reload before acquiring Zentui rendering.

When a predecessor slot is absent, modern Pi's callback-failure boundary invokes
its own native call/result fallback (including arguments, collapsed limits,
expansion hints, and image handling). This behavior is tested against public Pi
1.0.3/1.0.4 components; Zentui does not import private fallback methods, fabricate a
native component, or throw from paint to request native restoration.
Hand edits are loaded on the intended `/reload`, without mirroring or an extra
reload. Disposing the runtime makes its registered closure permanently neutral;
the public API has no unregister operation.

Presentation helpers are faithfully adapted from pinned pi-tool-display 0.5.0,
without importing its package or config. Full public tool-card ANSI fixtures are
reproducibly generated from unchanged upstream source and checked against the
candidate with matching themes/options/widths. Bash uses the upstream timed
spinner/text in a bounded, owner-scoped lifecycle. Exact comparisons apply to the
supported normal-input domain; safety caps, unavailable complete preimages,
unsupported shapes/hosts and existing-card shell restoration require the
explicit guards described above. Attribution and MIT notices are included.

The user-approved Unicode fix expands changed-word emphasis boundaries to whole
graphemes, preventing the upstream surrogate/combining/ZWJ corruption. Those
vectors intentionally differ from unpatched upstream and match a separately
recorded minimal corrected reference. The native-style generic calls, superseding OpenCode-style MCP calls/output,
no-preimage write wording and search separators are separately declared above. All remaining
oracle-tested normal rows are identical within the matched domains; collapsed
MCP calls intentionally supersede the earlier count-only presentation.
Development oracle generation and safety-domain details are recorded in the
[attribution/source map](./tool-display-attribution.md).
