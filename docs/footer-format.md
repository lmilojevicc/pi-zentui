# Footer format template

[Back to README](../README.md) · [Configuration reference](./configuration.md)

Set `components.footer.styles.starship.format` for complete control over the Starship Footer. The template supports:

- `$variable` and `${variable}` tokens
- literal text and spaces
- conditional groups `( ... )` that disappear when every nested variable is empty
- `$join_sep` conditional field joining
- `$fill` layout boundaries

A custom format overrides `components.footer.styles.starship.segments` for the wide layout. Empty or omitted format uses the segment layout. Responsive mode first reflows wide content, then uses the independent `compactFormat` template; compact variables do not follow built-in segment toggles. `compactMaxLines` limits compact rows, not segment selection. No settings toggle rewrites either template. `$codex_quota` is an exception to segment-toggle bypass: it always requires the independent Footer quota consent toggle and active `openai-codex` provider.

## Examples

A complete left/right layout:

```json
{
  "components": {
    "footer": {
      "styles": {
        "starship": {
          "format": "$os $username $cwd($sep$session_name)( on $git_branch)( $git_status)( via $runtime)$fill($context)($sep$tokens)($sep$cost)($sep$time)"
        }
      }
    }
  }
}
```

Center the branch between directory and cost:

```json
{
  "components": {
    "footer": {
      "styles": {
        "starship": {
          "format": "$cwd $fill $git_branch $fill $cost"
        }
      }
    }
  }
}
```

Show model, provider, and active thinking level in the Footer:

```text
/zentui format "$model $provider( $thinkingLevel)"
```

Add `$model $provider( $thinkingLevel)` to `components.footer.styles.starship.compactFormat` separately to keep these details in compact layouts. Defaults and the built-in Model info segment are unchanged.

In OMP, include the independent fast-mode token with `/zentui format "$model $provider( $thinkingLevel)( · $fast_mode)"`. Add it to `compactFormat` separately if needed. `$fast_mode` uses the active model's service-tier family and OMP's model capability checks, not another provider family's saved priority preference.


To keep metadata on the right, set both templates independently:

```json
{
  "format": "$cwd( in $session_name)( on $git_branch)( $git_status)( $git_state)( via $runtime)$fill$model($sep$provider)($sep$thinkingLevel)($sep$context)( $auto_compaction)($sep$tokens)( $cache_read)( $cache_write)($sep$cost)( $subscription)",
  "compactFormat": "$cwd$wrap(in $session_name)$wrap(on $git_branch) $git_status$fill$model$wrap_sep($provider)$wrap_sep($thinkingLevel)$wrap_sep$context$wrap_sep$tokens"
}
```

These keys belong under `components.footer.styles.starship`. Separate metadata chunks can wrap at narrow widths; a single combined chunk may truncate thinking. Earlier right-hand chunks take priority; project details and later telemetry may be truncated or omitted.

Footer configuration never changes the Editor. To hide those details there, independently customize `components.editor.styles.opencode.metadataFormat` or `components.editor.styles.opencode-copy-friendly.metadataFormat`, omitting `$model`, `$provider`, and `$thinking`. Use `" "` for no metadata; `""` restores the default. See [Editor metadata format](./configuration.md#editor-metadata-format).

Set or clear the template at runtime:

```text
/zentui format "$cwd( on $git_branch)($git_status)$fill($context)($sep$tokens)"
/zentui format clear
```

The released flat `footerFormat` and `footerSegments` keys remain accepted only as migration input.

## Variables

| Token | Aliases | Renders |
| --- | --- | --- |
| `$cwd` | `$directory` | current directory |
| `$session_name` | | current Pi session name |
| `$git_branch` | `$branch` | Git branch with icon |
| `$git_status` | `$status` | `[!?↑]` status block |
| `$git_state` | `$state` | `REBASING`, `MERGING`, and similar state, with optional `n/m` |
| `$git_commit` | `$commit` | short commit hash and exact-match tag when present |
| `$git_tag` | `$tag` | exact-match tag at HEAD |
| `$git_metrics` | | aggregate line changes `+added −deleted` |
| `$git_added` | | added line count (`+N`) |
| `$git_deleted` | | deleted line count (`−N`) |
| `$runtime` | | runtime icon and version |
| `$model` | | selected Footer model label |
| `$provider` | | formatted provider label |
| `$thinkingLevel` | | current thinking level; empty when unavailable or `off` |
| `$fast_mode` | | OMP's supported `fast` or `ultrafast` selection; empty when off, unsupported, or running Pi |
| `$package` | | project package version as `is <glyph> <version>` |
| `$package_version` | | raw project package version |
| `$session_duration` | `$duration` | session running time |
| `$username` | | `user@host` |
| `$os` | | operating-system icon |
| `$time` | | current time `HH:MM` |
| `$context` | | context usage; finite percentages use one decimal |
| `$codex_quota` | | remaining account quota, for example `5h 80% | week 60%`; gated by `components.footer.codexQuota` |
| `$tokens` | | input/output totals and existing cache-hit percentage |
| `$cache_read` | | cache-read total (`R1.2k`); empty at zero or when unavailable |
| `$cache_write` | | cache-write total (`W300`); empty at zero or when unavailable |
| `$cost` | | session cost |
| `$subscription` | | `(sub)` in subscription mode; otherwise empty |
| `$auto_compaction` | | `(auto)` when automatic compaction is enabled |
| `$sep` | `$separator` | themed `|` using `colors.separator` |
| `$join_sep` | — | join populated sibling fields with the styled surface separator |
| `$fill` | — | wide or compact layout boundary |

Each variable renders its core value without prose prefixes such as `on` or `via`; add those words as literals.

### Shared live metadata and OMP host data

Pi and OMP supply `$pr_number`, `$pr_url`, and `$ci` through one passive, demand-controlled GitHub snapshot. Pi also supplies `$token_rate`: the current interaction’s completed model-work average (`48 tok/s avg`, or `— tok/s avg` when unknown), retained until a new interaction. It uses final output divided by summed observed call durations, including initial wait and client preparation but excluding tools/gaps; an in-flight call keeps the completed-calls-so-far aggregate, never a live estimate. Working line retains its separate recent live rate. OMP retains its native rate semantics. See [live metadata](./configuration.md#live-metadata) for identity/head qualification, TTLs, empty/stale/no-checks behavior and lifecycle limits. Templates opt in without rewriting defaults; disabled/native/unowned surfaces do not poll.

OMP additionally supplies `$session_id`, `$subagent_count`,
`$token_rate`, `$active_time`, `$hostname`, `$usage_quota`, `$collaboration`,
`$stream_state`, `$vim_mode`, `$plan_mode`, `$prewalk_mode`, `$goal_mode`,
`$vibe_mode`, and `$loop_mode`. These explicit built-ins also work in Opencode
metadata and Minimalist slots; they are not aliases for OMP's segment IDs or
third-party `$extensions`. Other Pi host-only and unsupported/inactive capabilities render empty.
See the [data/source reference](./configuration.md#omp-template-data).

For example:

```json
{
  "format": "$cwd( · PR #$pr_number)( · $plan_mode)( · $loop_mode)$fill$context( · $active_time)( · $token_rate)",
  "compactFormat": "$cwd$wrap(PR #$pr_number)$wrap($active_time)$wrap($token_rate)"
}
```

Keep `$session_id` separate from the session name and `$active_time` separate
from wall-clock `$session_duration`. Optional groups hide unavailable fields,
including missing PR/rate/quotas, without leaving their labels behind.
`$pr_url` is safe plain HTTPS text, not an injected terminal hyperlink.

Referencing `$usage_quota` explicitly opts into OMP's public usage-report API,
which may refresh authenticated reports from configured providers. Snapshots
are demand-driven and cached for up to five minutes, subject to window resets
and current provider/model/account scope. Defaults make no new requests; this
does not enable or configure the independent `$codex_quota` consent toggle.

### `$codex_quota` consent and freshness

Set `components.footer.codexQuota: true` and select Starship to opt in. The built-in wide layout and shipped compact default include quota conditionally. Saved custom formats are unchanged; add `($sep$codex_quota)` to `format` and `$wrap_sep($codex_quota)` to `compactFormat` where desired. Templates without the token never have quota appended outside them.

The token is empty when consent is off or the active provider is not exactly `openai-codex`. With consent, missing values use `--`; exhausted quota uses `0%`; retained values after a transient failure carry `stale`. Quota is omitted as a unit if it cannot fit safely. Editor has its own independent consent toggle. See [quota configuration](./configuration.md#codex-account-quota) for background polling, public auth capability requirements, and private-endpoint limitations.

### `$cwd` path modes

`$cwd`, the built-in wide directory segment, and responsive compact/final fallback all use `components.footer.styles.starship.pathDisplay`. Its unchanged default is `{ "mode": "basename", "depth": 0 }`.

- `basename` renders only the current directory name.
- `full` renders the full path with `~` home abbreviation.
- Opt-in `repository` excludes the repository directory name: repository root renders `.`, while `/repo/extensions/zentui` renders `extensions/zentui`.

For `full` and `repository`, `depth` keeps the final N components and `0` is unlimited. Repository mode forms the repository-relative path first and then applies depth; for example, `/repo/packages/core/src` at depth `2` renders `…/core/src`. Root always remains `.`. Separator normalization matches the existing cwd formatter.

Repository mode recognizes normal repositories and `.git` file worktrees. If the root is missing, stale, unsafe for the current cwd, or unavailable during a cwd/repository transition or failed lookup, `$cwd` silently uses the unlimited `full` path until current root state is safe. This fallback retains `~` abbreviation and never emits a relative path from a stale root.

### Compact-only structural tokens

`components.footer.styles.starship.compactFormat` also supports:

| Token | Behavior |
| --- | --- |
| `$wrap` | starts a new compact chunk with a space boundary; the packer keeps it on the current line when it fits or wraps it to the next line |
| `$wrap_sep` | starts a new compact chunk with the configured `$sep` boundary instead of a plain space |
| `$extensions` | expands active third-party statuses into independently packable compact chunks, preserving their rendered text and configured color modes |

Example:

```json
{
  "components": {
    "footer": {
      "styles": {
        "starship": {
          "compactFormat": "$cwd$wrap(in $session_name)$wrap(on $git_branch) $git_status$wrap$context$wrap_sep$tokens$wrap_sep$extensions"
        }
      }
    }
  }
}
```

These tokens are structural in compact mode: `$wrap` and `$wrap_sep` render no text themselves, and `$extensions` is empty when no third-party status is active.

## Custom extension values

Publishers can provide named text through `zentui:variable` protocol v1, without
owning or wrapping Footer. Map stable publisher keys to simple local names under
`components.footer.styles.starship.variables`, then reference the names in either
template:

```json
{
  "components": {
    "footer": {
      "styles": {
        "starship": {
          "variables": { "quota": "@scope/usage:quota" },
          "extensionColorMode": "original",
          "format": "$cwd$fill($quota)($sep$cost)",
          "compactFormat": "$cwd$fill($quota)$wrap_sep$tokens"
        }
      }
    }
  }
}
```

These JSON-only aliases cannot replace built-in variables, aliases such as
`branch`, structural tokens, or prototype names, except a valid explicit `ci` alias takes precedence over GitHub CI and does not demand GitHub. Missing values are empty;
conditional groups remove associated optional text. No custom value is appended
outside an explicit template. A compact-only reference creates demand only
while responsive mode is enabled. Native and Hidden never acquire this registry
on behalf of Footer, and configuring aliases does not select Starship or enable
Editor.

Original is the default color mode and preserves permitted publisher SGR and
HTTP(S) hyperlinks. Zentui strips incoming styling and uses Footer's own
`colors.extensionStatus` role and color source. These choices are independent of
Editor and of the existing `extensionStatuses.colorModes` preferences. Sparse `components.footer.customValueColors` overrides style individual publisher IDs across aliases in both templates. Explicit styles replace publisher styling; empty is unstyled, Reset deletes one leaf. `/zentui` → Footer → **Individual custom value colors** offers current, aliased and saved keys. See [individual custom value colors](./configuration.md#individual-custom-value-colors).

Values are kept whole through wide alignment, reflow, and compact packing.
When a value would be partially cropped or split, Footer recomposes without it
instead of showing misleading partial quotas or labels. Width fitting uses safe
internal probes that are restored before terminal output. Built-in narrow-width
behavior remains unchanged, and template literals still own their spacing.

The compact `$extensions` token above its existing configuration section
continues to expand `ctx.ui.setStatus()` statuses; it is **not** an aggregate of
new custom values. A publisher can use `setStatus()` as its own fallback when
capability is inactive, and must remove only its own fallback when active to
avoid duplicate output. See [publisher protocol](./configuration.md#custom-value-publisher-protocol-v1)
for capability, bounds, session lifecycle, and ownership rules. Disabling one
surface does not evict a value still consumed by another owned surface.

## `$fill` behavior

In the wide template:

| Count | Layout |
| ---: | --- |
| 0 | everything left-aligned |
| 1 | tokens before are left-aligned; tokens after are right-aligned |
| 2 | before first is left, between is truly centered, after second is right |
| 3+ | first two count; extras are ignored |

The centered middle zone uses `floor((gap - middle) / 2)`, matching third-party statuses placed in the middle. During responsive two-row reflow, custom templates with a top-level `$fill` keep the right-bearing row right-aligned; a middle zone sharing that row retains its order, not centering.

In `compactFormat`, the first top-level `$fill` splits left/right zones and flushes the current chunk. Additional fills are ignored (no compact center zone). Nested fills are nonstructural in both templates. Compact fills were previously ignored; existing templates containing them now opt into alignment. Templates without fill and shipped defaults are unchanged.

Compact packing reserves right-hand chunks first, in template order, within `compactMaxLines`, then fits left-hand chunks into the remaining row budgets. Nonempty zones have at least one space between them. `$wrap_sep` separators appear only between chunks on the same row. Right content ends at the inner right edge (one cell inside the terminal margin); an empty right zone retains ordinary left packing. Long chunks truncate and capped omissions use `…`; arbitrarily narrow layouts cannot retain every value.

## Conditional groups

Wrap optional content in parentheses:

```text
$cwd( on $git_branch)($git_status)$fill($context)
```

If every variable inside a group is empty, the group and its literal text are dropped. `$session_name` is available whenever a custom format is set, independently of segment visibility; use a group such as `($sep$session_name)` so unnamed sessions leave no separator.

## Conditional joining

Use `$join_sep` (or `${join_sep}`) between fields to insert a separator only
between populated fields:

```text
$session_name$join_sep($git_branch $git_status)
$a$join_sep$b$join_sep$c
```

The first example shows just the session, just the Git field, both with one
separator, or nothing. Git status can populate its field even without a branch.
The chain renders `a SEP c` when the middle field is missing, never two gaps.
Leading, trailing, or consecutive markers cannot create orphan separators.
Literal-only visible fields count; unknown/unsupported variables are empty.
Whitespace-only fields, SGR resets, and OSC hyperlink wrappers do not count as
content. Retained fields keep their ANSI styles, hyperlinks, Unicode and icons.

**Do not pad the marker with spaces:** the surface's already styled separator
owns its spacing. Retained field output is not implicitly trimmed; any literal
padding inside a populated field remains template-owned. Footer uses its existing
styled ` | `, Minimalist its configured ` – ` or ` · `, and both Opencode variants
use neutral border-styled ` · ` for this marker only.

Each parenthesized group is a local sibling scope. For example,
`$a$join_sep($b$join_sep$c)` joins the group as a whole to `a`, while
`$a($join_sep$b)` cannot borrow `a` to insert a separator inside the group.
Existing optional-group liveness rules still apply: the marker is not content,
and join-only or whitespace-only marker groups disappear. Top-level `$fill`
zones and compact `$wrap`/`$wrap_sep` chunks are hard boundaries: joins cannot
cross zones, chunks, or rows. Nested fills remain nonstructural. For example,
`$a$join_sep$fill$join_sep$b` renders separate `a` and `b` zones, and
`$a$join_sep$wrap_sep$join_sep$b` leaves any same-row separator to the compact
packer. `$wrap_sep` is not an alias for `$join_sep`.

This is additive: templates without the marker keep their old behavior,
including whitespace-only values, `$sep`/`$separator`, and Footer's existing
pipe-orphan cleanup. No defaults or saved templates are migrated. Joining happens
before width fitting; narrow displays still may truncate or omit fields.
`join_sep` is now reserved and cannot be a custom alias on any template owner;
rename a previously configured alias with that name. The marker does not resolve
publisher data or create host/Git/quota demand; the joined fields still do.
Older installed versions treat it as unknown/empty and cannot conditionally join;
load or upgrade to a version supporting the marker before using it.

## Formatting rules

- Literal text, pipes, and spaces render verbatim; the template owns spacing.
- `$session_name` is independent of `components.footer.styles.starship.segments.sessionName` in custom formats.
- Built-in wide layout appends cache totals to Tokens, `(sub)` to Cost, and `(auto)` to Context when available.
- Custom formats keep `$tokens`, `$cost`, and `$context` backward-compatible. Add `$cache_read`, `$cache_write`, `$subscription`, and `$auto_compaction` explicitly for atomic telemetry.
- `DEFAULT_COMPACT_FOOTER_FORMAT` omits model/provider, thinking level, and atomic telemetry. Add variables to `components.footer.styles.starship.compactFormat` to opt in at narrow widths. The flat `compactFooterFormat` key remains migration-only input.
- Auto-compaction settings refresh at the next normal Footer synchronization. Unsupported Pi capabilities or read errors omit optional markers.
- Unknown variables render empty.
- `$fill`, `$wrap`, and `$wrap_sep` are structural and never render visible text. `$join_sep` emits a separator only between populated sibling fields.
