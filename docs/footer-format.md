# Footer format template

[Back to README](../README.md) · [Configuration reference](./configuration.md)

Set `components.footer.styles.starship.format` for complete control over the Starship Footer. The template supports:

- `$variable` and `${variable}` tokens
- literal text and spaces
- conditional groups `( ... )` that disappear when every nested variable is empty
- `$fill` layout boundaries

A custom format overrides `components.footer.styles.starship.segments`. Empty or omitted format uses the segment layout.

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
| `$package` | | project package version as `is <glyph> <version>` |
| `$package_version` | | raw project package version |
| `$session_duration` | `$duration` | session running time |
| `$username` | | `user@host` |
| `$os` | | operating-system icon |
| `$time` | | current time `HH:MM` |
| `$context` | | context usage; finite percentages use one decimal |
| `$tokens` | | input/output totals and existing cache-hit percentage |
| `$cache_read` | | cache-read total (`R1.2k`); empty at zero or when unavailable |
| `$cache_write` | | cache-write total (`W300`); empty at zero or when unavailable |
| `$cost` | | session cost |
| `$subscription` | | `(sub)` in subscription mode; otherwise empty |
| `$auto_compaction` | | `(auto)` when automatic compaction is enabled |
| `$sep` | `$separator` | themed `|` using `colors.separator` |
| `$fill` | — | wide-format layout boundary |

Each variable renders its core value without prose prefixes such as `on` or `via`; add those words as literals.

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

| Count | Layout |
| ---: | --- |
| 0 | everything left-aligned |
| 1 | tokens before are left-aligned; tokens after are right-aligned |
| 2 | before first is left, between is truly centered, after second is right |
| 3+ | first two count; extras are ignored |

The centered middle zone uses `floor((gap - middle) / 2)`, matching third-party statuses placed in the middle.

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
- `DEFAULT_COMPACT_FOOTER_FORMAT` omits model/provider and atomic telemetry. Add variables to `components.footer.styles.starship.compactFormat` to opt in at narrow widths. The flat `compactFooterFormat` key remains migration-only input.
- Auto-compaction settings refresh at the next normal Footer synchronization. Unsupported Pi capabilities or read errors omit optional markers.
- Unknown variables render empty.
- `$fill`, `$wrap`, and `$wrap_sep` are structural and never render visible text.
