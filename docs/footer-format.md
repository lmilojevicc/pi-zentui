# Footer format template

[Back to README](../README.md) · [Configuration reference](./configuration.md)

Set `components.footer.styles.starship.format` for complete control over the Starship Footer. The template supports:

- `$variable` and `${variable}` tokens
- literal text and spaces
- conditional groups `( ... )` that disappear when every nested variable is empty
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
| `$fill` | — | wide or compact layout boundary |

Each variable renders its core value without prose prefixes such as `on` or `via`; add those words as literals.

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

## Formatting rules

- Literal text, pipes, and spaces render verbatim; the template owns spacing.
- `$session_name` is independent of `components.footer.styles.starship.segments.sessionName` in custom formats.
- Built-in wide layout appends cache totals to Tokens, `(sub)` to Cost, and `(auto)` to Context when available.
- Custom formats keep `$tokens`, `$cost`, and `$context` backward-compatible. Add `$cache_read`, `$cache_write`, `$subscription`, and `$auto_compaction` explicitly for atomic telemetry.
- `DEFAULT_COMPACT_FOOTER_FORMAT` omits model/provider, thinking level, and atomic telemetry. Add variables to `components.footer.styles.starship.compactFormat` to opt in at narrow widths. The flat `compactFooterFormat` key remains migration-only input.
- Auto-compaction settings refresh at the next normal Footer synchronization. Unsupported Pi capabilities or read errors omit optional markers.
- Unknown variables render empty.
- `$fill`, `$wrap`, and `$wrap_sep` are structural and never render visible text.
