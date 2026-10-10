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
remain visible. Image, mixed, empty, or unsupported results delegate unchanged.
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
selected. Diffs preserve anchors and emphasize changed word spans, wrap or clip
long lines, and report omitted hunks or safety truncation. Colors use Pi semantic
theme roles; owner-local raw color overrides are not currently supported.

Live write/edit preimages are bounded, workspace-scoped best-effort previews.
Symlinks, external, binary, special, unreadable, or oversized files are rejected.
Historical rendering never reads files to reconstruct an old preimage. When
preimages are unavailable, the renderer reports that rather than inventing an
overwrite/create diff. Preview caches are bounded and cleared across session,
tree, reload, shutdown, and release boundaries. These previews are not a security
sandbox against concurrent filesystem mutation.

Text input is capped at 1 MiB, diff parsing at 8000 lines, generated diffs at
4000 lines per side with bounded comparison work, and expanded text at 20000
logical lines. Limits are reported instead of silently implying full output.

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

Unlisted or disabled tools delegate. `kind` is `generic | mcp`; boolean shorthand
is accepted with generic rendering. Omitted `outputMode` inherits `mcpOutputMode`
for MCP and summary for generic; explicit hidden/summary/preview wins. Deleting
`outputMode` resumes inheritance. Existing renderers or shells remain owned by
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
freeze omitted custom MCP output inheritance or generate colors.

On supported hosts, live mode edits affect rows Zentui still owns. A row that
has delegated to its predecessor stays delegated for its remaining lifetime,
including partial-to-final delivery, to preserve predecessor cleanup. Initially
native rows need recreation/rebuild/reload before acquiring Zentui rendering.
Hand edits are loaded on the intended `/reload`, without mirroring or an extra
reload. Disposing the runtime makes its registered closure permanently neutral;
the public API has no unregister operation.

Presentation is inspired by pinned pi-tool-display 0.5.0, not pixel-identical:
semantic theme colors and bold word spans replace its custom RGB emphasis;
Bash progress is event-driven without an extra animation timer. Attribution and
the upstream MIT notice are in the linked focused document and packaged source.
