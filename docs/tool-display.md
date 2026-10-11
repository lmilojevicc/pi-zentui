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
Pi 1.0.3 and 1.0.4 expose this contract; older supported Pi hosts without it keep
native/predecessor rendering. OMP skin-only mode does not expose Tool display
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
follow upstream presentation. Hidden read/search/MCP modes hide result text, including errors, even when expanded; select Summary or Preview to reveal it. The host retains the actual error status/card color and full result/image data. Unknown result shapes delegate unchanged.
Expansion uses the host's tool expansion action.

## Diff and preview controls

| Field | Default | Accepted values |
| --- | --- | --- |
| `previewLines` | 8 | 1–80 |
| `bashCollapsedLines` | 10 | 0–80 |
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
preimages are unavailable, the renderer reports that rather than inventing an
overwrite/create diff. Preview caches are bounded and cleared across session,
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
Zentui retains the approved canonical label (`MCP zentui_demo/echo (1 arg)`) so
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
recorded minimal corrected reference; all other oracle-tested normal rows are
identical within the matched domains above.
Development oracle generation and safety-domain details are recorded in the
[attribution/source map](./tool-display-attribution.md).
