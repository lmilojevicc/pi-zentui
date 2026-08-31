# Zentui configuration reference

[Back to README](../README.md) · [Footer format template](./footer-format.md)

Zentui reads optional user configuration from `~/.pi/agent/zentui.json`. Missing or invalid known values fall back to defaults. Unknown fields are ignored at runtime but preserved on disk by component save operations where they are user-owned migration or future-style data.

## `/zentui` settings

The interactive `/zentui` menu is split into nine component-oriented sections. Use `Tab` and `Shift+Tab` to switch sections:

1. **Appearance** — selector-border enablement, style, and colors; icon mode.
2. **Editor** — enablement, style, colors, model label, border behavior, viewport indicators, settings for the selected editor style, and a static synthetic preview.
3. **User messages** — enablement, style, colors, and a static synthetic Markdown preview.
4. **Thinking (Experimental)** — restart-gated private Rail, Tree, or Streaming rendering; it may break after Pi updates.
5. **Working line** — ownership, settled Turn summary, spinner and text speeds, optional spinner-color motion, text animation, color source, custom messages, Tool/Elapsed/Thinking time/Tokens segments, and animated preview.
6. **Footer** — Native, Starship, or Hidden. Starship additionally exposes colors, model label, responsive layout, separator, context style, and path display.
7. **Segments** — visibility toggles for non-Git Starship segments.
8. **Git** — Starship Git segment and probe controls.
9. **Extensions** — Starship extension-status placement and color controls for active keys.

Editor, User messages, Thinking (Experimental), and Working line retain independent configuration. Editor, User-message, and Thinking previews remain visible while their component is disabled. Only the Working-line preview owns an animation timer. Footer-specific rows are shown only while Starship is selected, while Segments, Git, and Extensions remain available for preconfiguration under every Footer style.

Free-form values such as custom formats, Opencode metadata formats, raw colors/styles, and inactive extension keys remain JSON-only. Working-line speed accepts validated custom milliseconds in `/zentui`.

Useful slash-command shortcuts:

```text
/zentui editor enable
/zentui editor disable
/zentui editor toggle
/zentui messages enable
/zentui messages disable
/zentui messages toggle
/zentui user-messages
/zentui working-line
/zentui statusline enable
/zentui statusline disable
/zentui statusline toggle
/zentui viewport-indicators enable
/zentui viewport-indicators disable
/zentui viewport-indicators toggle
/zentui format "$cwd on branch $git_branch$git_status using $runtime $fill $context"
/zentui format clear
```

`footer`, `statusline`, `status`, and `status line` are aliases. Enable selects Starship, disable selects Native, and toggle selects Native only from Starship; Native or Hidden toggle to Starship.

## Complete default configuration

Copy this example and change only the values you need. Optional editor source-aware overrides such as `editorRail`, `editorGitBranch`, and `editorThinkingMax` are intentionally omitted.

```json
{
  "projectRefreshIntervalMs": 30000,
  "components": {
    "editor": {
      "enabled": true,
      "style": "opencode",
      "colorSource": "theme",
      "borderColorMode": "static",
      "modelLabel": "id",
      "viewportIndicators": true,
      "styles": {
        "opencode": {
          "metadataFormat": "$model  $provider(  $thinking)",
          "completionMenu": "palette"
        },
        "opencode-copy-friendly": {
          "metadataFormat": "$model  $provider(  $thinking)",
          "completionMenu": "palette"
        },
        "accent-rail": {
          "rail": "▎",
          "asciiRail": "|",
          "transparent": false
        },
        "minimalist": {
          "pathDisplay": "compact",
          "contextFormat": "percent",
          "contextGauge": false,
          "showSessionName": true,
          "showTimer": true,
          "showCost": true,
          "showGit": true,
          "contextThresholds": {
            "warning": 70,
            "error": 90
          }
        }
      }
    },
    "userMessages": {
      "enabled": true,
      "style": "framed",
      "colorSource": "theme",
      "styles": {
        "framed": {},
        "framed-copy-friendly": {},
        "compact": {},
        "labeled": {}
      }
    },
    "thinkingSteps": {
      "enabled": false,
      "mode": "tree"
    },
    "workingLine": {
      "enabled": false,
      "turnSummary": true,
      "spinner": "star-bloom",
      "spinnerIntervalMs": 100,
      "animateSpinnerColor": false,
      "textIntervalMs": 60,
      "textAnimation": "classic",
      "colorSource": "theme",
      "messages": {
        "custom": true,
        "values": [
          "Sautéing…",
          "Cooking…",
          "Ionizing…",
          "Zigzagging…",
          "Razzle-dazzling…",
          "Photosynthesizing…",
          "Nucleating…",
          "Brewing…",
          "Combobulating…",
          "Boogieing…",
          "Befuddling…",
          "Alchemizing…",
          "Conjuring…",
          "Baking…",
          "Simmering…",
          "Blanching…"
        ]
      },
      "segments": {
        "tool": true,
        "elapsed": true,
        "thought": true,
        "tokens": true
      }
    },
    "selectorBorders": {
      "enabled": true,
      "style": "zentui",
      "colorSource": "theme"
    },
    "footer": {
      "style": "starship",
      "colorSource": "theme",
      "modelLabel": "id",
      "styles": {
        "starship": {
          "format": "",
          "responsive": true,
          "compactFormat": "$cwd$wrap(in $session_name)$wrap(on $git_branch) $git_status$wrap$context$wrap_sep$tokens",
          "compactMaxLines": 2,
          "separator": "pipe",
          "contextStyle": "text",
          "contextThresholds": {
            "warning": 70,
            "error": 90
          },
          "pathDisplay": {
            "mode": "basename",
            "depth": 0
          },
          "segments": {
            "cwd": true,
            "sessionName": true,
            "gitBranch": true,
            "gitStatus": true,
            "gitCounts": false,
            "runtime": true,
            "modelInfo": false,
            "context": true,
            "tokens": true,
            "cost": true,
            "sessionDuration": false,
            "username": false,
            "time": false,
            "os": false,
            "packageVersion": false,
            "gitCommit": false,
            "gitMetrics": false
          },
          "gitBranch": {
            "maxLength": "full"
          },
          "gitCommit": {
            "hashLength": 7,
            "onlyDetached": true,
            "showTag": true
          },
          "gitMetrics": {
            "onlyNonzero": true,
            "ignoreSubmodules": false
          },
          "extensionStatuses": {
            "defaultPlacement": "right",
            "placements": {},
            "colorModes": {}
          }
        }
      }
    }
  },
  "icons": {
    "mode": "auto",
    "cwd": "",
    "git": "",
    "ahead": "↑",
    "behind": "↓",
    "diverged": "⇕",
    "conflicted": "=",
    "untracked": "?",
    "stashed": "$",
    "modified": "!",
    "staged": "+",
    "renamed": "»",
    "deleted": "✘",
    "typechanged": "T",
    "cacheHit": "󰆼",
    "editorPrompt": "",
    "rail": "│",
    "username": "",
    "time": "",
    "os": "",
    "package": ""
  },
  "colors": {
    "cwd": "bold cyan",
    "sessionName": "bold green",
    "gitBranch": "bold purple",
    "gitStatus": "bold red",
    "contextNormal": "bright-black",
    "contextWarning": "bold yellow",
    "contextError": "bold red",
    "tokens": "bright-black",
    "cost": "bold green",
    "extensionStatus": "bright-black",
    "separator": "bright-black",
    "runtimePrefix": "",
    "sessionDuration": "yellow",
    "packageVersion": "208",
    "gitCommit": "bold green",
    "gitMetricsAdded": "bold green",
    "gitMetricsDeleted": "bold red",
    "username": "bold yellow",
    "time": "bold yellow",
    "os": "bold white",
    "editorAccent": "accent",
    "editorPrompt": "accent",
    "editorBorder": "borderMuted",
    "editorModel": "accent",
    "editorProvider": "text",
    "editorThinking": "muted",
    "editorThinkingMinimal": "thinkingMinimal",
    "editorThinkingLow": "thinkingLow",
    "editorThinkingMedium": "thinkingMedium",
    "editorThinkingHigh": "thinkingHigh",
    "editorThinkingXhigh": "thinkingXhigh"
  }
}
```

## Core configuration

- Style values accept Starship/terminal strings such as `bold purple`, `fg:202`, `#89b`, `#89b4fa`, and `bg:blue fg:bright-green`, or Pi theme tokens such as `accent`, `borderMuted`, and `thinkingHigh`. Short `#rgb` values expand to `#rrggbb`.
- `projectRefreshIntervalMs` controls project-status polling. `0` disables polling. Values `1..4999` clamp to the five-second minimum; invalid or non-finite values use `30000`.
- `components.editor` owns Editor enablement, `opencode | opencode-copy-friendly | accent-rail | minimalist` style selection, color source, border mode, model label, viewport indicators, and all four style configurations.
- Editor `modelLabel` uses `id` by default; `name` uses the display name with ID fallback. Footer has an independent `modelLabel` control.
- `components.userMessages` owns User-message enablement, `framed | framed-copy-friendly | compact | labeled` style selection, and color source. Disabling it delegates byte-for-byte to Pi's native renderer.
- `components.thinkingSteps` independently owns opt-in **Thinking (Experimental)** display. It defaults to `{ "enabled": false, "mode": "tree" }`; canonical modes are `rail | tree | streaming`. The former persisted `streaming-experimental` value is accepted only as a migration alias and is normalized to `streaming` on save.
- All three modes decorate Pi's private host renderer at session startup and are tested on exact Pi versions 0.80.5, 0.83.0, 0.84.0, and 0.84.4. Every live enable, disable, or mode change persists but leaves the active startup snapshot unchanged until restart.
- `components.workingLine.enabled` is the sole Working-line ownership switch. Thinking (Experimental) never enables, configures, or owns the Working line and leaves the existing **Thinking time** option unchanged.
- `components.selectorBorders` owns selector-border enablement, fixed `zentui` style, and color source. Disable it for native Pi behavior.
- `components.footer` owns `native | starship | hidden` style selection, color source, model label, and Starship options. Hidden installs an empty component with zero rows.
- Starship's package-version segment reads the project manifest and is distinct from the runtime segment, which reports the installed toolchain.
- Active third-party statuses from `ctx.ui.setStatus()` can be placed left, middle, or right, hidden per key, and assigned independent color modes.
- The shown `editor*` colors match the default `theme` source. Omit them to preserve source-aware defaults when switching between `theme` and `terminal`.

### Footer path display

`components.footer.styles.starship.pathDisplay.mode` accepts `basename`, `full`, or the opt-in `repository`; the unchanged default is `basename`. Repository mode removes the repository directory name: at `/repo` it renders `.`, and at `/repo/extensions/zentui` it renders `extensions/zentui`. Zentui finds the nearest ancestor with a `.git` directory or worktree `.git` file without starting an extra Git process.

For `full` and `repository`, `depth` is the number of final components to retain. `0` is unlimited. Repository mode first creates the path relative to the repository root, then applies depth, so `/repo/packages/core/src` with `depth: 2` renders `…/core/src`; repository root remains `.` at every depth. `/zentui` exposes **Repository** as a separate Footer path-display choice and keeps the depth control for both modes.

Repository roots are associated with the cwd that produced them. While the current root is missing, stale, outside the cwd, still being refreshed, or unavailable after a lookup failure or Git-to-non-Git transition, Zentui silently renders the unlimited `full` path, including `~` home abbreviation. Built-in and custom `$cwd` layouts use the same result at wide and compact widths. These options belong only to the Starship Footer; Minimalist Editor path semantics are unchanged.

### Color ownership

- `editorAccent` styles Opencode Editor and User-message accent rails plus the Labeled message label.
- Optional `editorRail` styles only Accent Rail. When omitted, theme mode uses warm `syntaxNumber`; terminal mode uses portable color 215.
- `editorPrompt` styles the copy-friendly Opencode prompt glyph. When omitted it uses `editorAccent`, then the default accent fallback.
- `editorBorder` styles Framed and Framed copy-friendly previous-message borders and the active editor in static border mode.
- Optional `editorGitBranch` owns Minimalist branch color independently from Footer `gitBranch`. When omitted, Minimalist uses `bold syntaxKeyword` in theme mode or `bold blue` in terminal mode.
- `editorModel`, `editorProvider`, and `editorThinking*` style editor metadata. `editorThinking` applies to every non-`off` level unless a level-specific key is set.
- Optional `editorThinkingMax` falls back through `editorThinkingXhigh` and then `editorThinking`; when all are omitted, the active source-specific thinking fallback remains in control. Neither optional key is materialized in the complete-default JSON above.
- `colors.workingLineLow`, `colors.workingLineMid`, and `colors.workingLineHigh` optionally override the Working-line palette. Defaults are `dim`, `muted`, and `bold accent` in theme mode, or `bright-black`, `cyan`, and `bold cyan` in terminal mode.

## Editor styles

### Accent Rail

Set `components.editor.style` to `accent-rail` or select **Accent Rail** in `/zentui`. Each input row uses its style-owned `rail` glyph (`▎`, or `asciiRail` in ASCII mode), one blank cell before text, and Pi's neutral filled surface. It intentionally has no prompt glyph, metadata, enclosing border, or blank chrome row. Viewport counts appear only while content is clipped.

Known autocomplete rows retain Pi's native text, descriptions, and scrolling on the same full-width surface. The selected native `→` becomes the configured rail without replacing Pi's selected-text color. Ambiguous third-party editor layouts fail open using already-rendered native rows.

In fullscreen Pi 0.84.x, Zentui applies a private, shape-checked layout workaround only to the active owned one-row Accent Rail editor. Pi's dock currently reserves a three-row minimum for its bordered native editor; the workaround preserves that minimum but positions a one-row rail as `[blank, rail]`, leaving Pi's final padding row before the independent Footer. Other editor styles, regular mode, multiline input, viewport indicators, and autocomplete fail open unchanged. Unsupported Pi versions or changed internal shapes skip the workaround. Remove this compatibility path when [upstream Pi's fullscreen dock](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/interactive-mode.ts) exposes composer minimum-size control or no longer hard-codes a three-row editor minimum. This link identifies the upstream source seam; it does not imply an upstream issue exists.

Set `ZENTUI_DEBUG=1` when launching Pi to log the workaround diagnostic without adding normal UI noise. Maintainers can probe an explicitly installed compatible host with `ZENTUI_TEST_GLOBAL_PI=/path/to/pi npx vitest run test/accent-rail-layout-patch.test.ts -t "explicitly selected"`.

`transparent` defaults to `false`. Set it to `true` or select **Transparent** in `/zentui` to remove only Zentui-owned input and autocomplete backgrounds while preserving geometry, rail/text colors, and native autocomplete backgrounds. The rail and gap are rendered decoration, not underlying prompt text; terminal drag or rectangular selection can still include them.

### Minimalist

Set `components.editor.style` to `minimalist` or select it in `/zentui`. The rounded frame places viewport counts, Bash state, current/completed turn duration, and explicit session name at top left; cost, model, thinking, and context at top right; viewport count plus Git at bottom left; and configured path at bottom right. Unnamed sessions add no placeholder.

Path examples are `src` (`compact`), `zentui/src` (`project`), and `~/Projects/zentui/src` (`full`). Context can render as `11%`, `11%/372k`, or, with the gauge enabled and enough room, `[█░░░░] 11%/372k`. The gauge shortens or disappears before the context text at narrow widths. Session name, timer, cost, and Git can be hidden independently; model, thinking, and context remain structurally stable.

Autocomplete stays inside the frame when Pi output can be split safely. Unknown third-party layouts fail open. Footer visibility remains independently controlled by `components.footer.style`; Minimalist does not remove Pi's header.

### Opencode completion menu

Both Opencode variants default to `completionMenu: "palette"` and can be configured independently. The transparent palette keeps captured native rows and embedded backgrounds, removes only a recognized selected `→` while preserving native emphasis, omits a narrowly recognized trailing count row such as `(1/47)`, fills available width without adding a background, and adds a bottom separator plus `↑↓ Navigate   Enter Use   Esc Close`.

It intentionally has no results header, range, category column, selected background, or side borders because Pi does not expose that structured data through a stable public API. Set a variant to `"native"` to preserve Pi's trailing rows byte-for-byte. Copy-friendly users who prioritize rectangular selection may prefer Native.

If autocomplete capture or frame provenance is ambiguous, Zentui returns the same native rows without rendering the editor again. Accent Rail and framed styles may therefore retain their reduced probe width on this rare fail-open path. Selected prefixes and trailing counts are rewritten only when they match narrow native patterns; unrecognized forms remain visible.

Tip: with `opencode-copy-friendly`, set Pi's `editorPaddingX` to `1` for a small left gutter without copying a rail.

### Editor metadata format

Each Opencode variant owns an independent `metadataFormat`:

```json
{
  "components": {
    "editor": {
      "styles": {
        "opencode": {
          "metadataFormat": "$model_name ($model_id)( · $provider)( · $thinking)( · $session_name)"
        },
        "opencode-copy-friendly": {
          "metadataFormat": "$model( · $provider)"
        }
      }
    }
  }
}
```

The syntax supports `$variable`, `${variable}`, literal text, spaces, conditional groups `( ... )` that disappear when every variable inside is empty, and the Footer's top-level `$fill` grammar. With no fill, metadata keeps its existing left-aligned layout. One fill creates left/right zones; two fills create left/middle/right zones; additional fills are ignored. For example:

```text
$model( · $provider)$fill($session_name)$fill($context · $tokens · $cache_hit)
```

The configured right zone and Pi's operational right status are right-aligned together, with the operational status kept first when space is limited. Configured left content is kept next, then configured right content. The middle zone is centered within the remaining gap between those sides, not at the terminal's absolute center, and is omitted completely if it cannot fit with one-cell separation. Narrow layouts truncate configured left/right content without an ellipsis. `$fill` inside a conditional group remains non-structural and renders empty.

| Token | Renders |
| --- | --- |
| `$model` | label selected by `components.editor.modelLabel` |
| `$model_id` | active Pi model ID |
| `$model_name` | display name; empty when unset |
| `$provider` | formatted provider label |
| `$thinking` | current level; empty when `off` |
| `$session_name` | current Pi session name; empty when unnamed |
| `$context` | compact current context usage and window, for example `26.8%/272k` |
| `$tokens` | cumulative session input/output tokens only, for example `↑76k ↓1.6k` |
| `$cache_hit` | latest assistant prompt cache-hit rate to one decimal; `0.0%` when unavailable |

`$context` uses Pi's current context snapshot and the live assistant context override, refreshing on the existing 250 ms streaming render cadence. `$tokens` and `$cache_hit` use authoritative persisted session snapshots, so they update at normal session synchronization boundaries rather than estimating in-progress totals. These variables are independent of Footer visibility, style, color source, and configuration.

Model variables use `editorModel`, provider uses `editorProvider`, and thinking uses the matching level style. Literal text, session name, and usage metadata use the neutral editor-border theme style. ANSI/VT sequences, controls, and line-breaking whitespace are sanitized without collapsing ordinary spaces.

Missing, non-string, or empty values use `$model  $provider(  $thinking)`. A non-empty format that resolves to no metadata preserves the normal blank spacer and metadata rows. This option is JSON-only; `/zentui format` controls the Footer.

## User-message styles

- `framed` preserves a full-width bordered box with an accent rail.
- `framed-copy-friendly` keeps full-width horizontal borders and spacer rows, removes the copied rail, and retains a one-cell leading gutter.
- `compact` uses only an accent rail with no surrounding border or padding rows.
- `labeled` uses a rounded box with fixed label `User`.
- Disabling styling delegates to Pi's native renderer; native is not a style ID.
- Zentui intentionally provides no custom `plain` style.

## Thinking (Experimental)

Rail, Tree, and Streaming share one restart-gated private `AssistantMessageComponent` wrapper. The saved `{ enabled, mode }` value is snapshotted at session start before transcript restoration. Disabled startup installs nothing. Every live settings change only persists the desired value; the active startup mode never deactivates, switches, or reactivates until restart. Shutdown restores native children, exact hidden-state ownership, and the predecessor descriptor. Private constructor, layout, Markdown identity, parser, theme, rendering, width, displacement, or cleanup incompatibility fails open to native thinking. Private APIs may break after any Pi update.

Rail parses each native contiguous thinking run and shows every label in that run. Tree shows the latest five in each run; neither aggregates across intervening text or tool blocks. Labels come from headings, top-level list items, and blank-line-separated prose; controls, malformed or over-limit input, unterminated fences/math, and unsupported structure leave that complete run native. Fenced code, Mermaid, display math, and indented nested content remain opaque bodies.

Each selected label is rendered from its original Markdown by a fresh Pi `Markdown` with the host child's exact theme, default `thinkingText`/italic style, and transform options. Native emphasis, code, links, HTML, LaTeX, and custom theme/transform callbacks therefore remain authoritative. Host horizontal padding is applied externally. Each label is exactly one terminal row; Pi TUI's ANSI/OSC/grapheme-aware width utilities crop the first rendered row and reserve one cell for `…` only when required. Empty, image, non-text, impossible-width, or throwing output restores the whole native run. Connectors are separate from Markdown and call the current `theme.fg("accent", connector)` every render, so custom themes directly control their appearance. Visible forms are:

```text
│ Thinking       ┆ Thinking
│ First          ├─ · Earlier
│ Latest         └─ · Latest
│ • Open         └─ • Open
```

Only an actually open thinking phase uses `•`; a text/tool transition or restored completion is settled. Rail and Tree preserve Pi's hidden state and native hidden label.

Streaming keeps the reviewed host-rendered behavior: while open it shows the latest five rendered terminal rows beneath `Thinking 7.1s`; completion folds under `Thought` or current-session `Thought for Ns`. Restored entries have no duration because Pi does not persist a reliable thinking-end timestamp. Only active Streaming startup owns its validated configured `app.thinking.toggle` binding and one-second timer. Ctrl+T expands/refolds native reasoning. Component and timing tracking are bounded to 256; evicted entries are restored natively first.

The exact all-mode private matrix covers Pi 0.80.5, 0.83.0, 0.84.0, and 0.84.4 under dark, light, and current themes, narrow/wide widths and resize. Thinking (Experimental) never owns or writes the Working line, including its unchanged **Thinking time** option, and does not own Footer, Editor, widgets, statuses, or model behavior.

## Working line

When enabled, Zentui owns Pi's complete working-row message and indicator. Five fixed-width spinner presets are available: Braille Orbit, Star Bloom, ASCII Pinwheel, Claude-inspired, and three-cell Pulse.

`messages.custom` defaults on and selects once per model turn from an editable, materialized 16-message list. Turning it off keeps the row owned and displays animated `Working…`; an empty or invalid list uses the same fallback. Optional segments show the latest active Tool, interaction-wide Elapsed time, cumulative wall-clock Thinking time, and whole-interaction Tokens.

Committed totals stay provider-reported across tool loops, retries, compaction retries, and queued continuations. During a response, live output follows Pi's `↓N` convention whether usage is provider-reported or temporarily estimated. Final usage reconciles atomically; input is never estimated. Labels are sanitized and width-bounded.

When Pi settles, the default-on **Turn summary** appends a persistent context-free row such as `Turn took 56s · thought for 10s · ↑7.1k ↓779`. Thought is cumulative wall-clock time from Pi's public thinking stream; overlaps count once and zero is omitted. Output already includes reasoning tokens, so reasoning is not added separately. Summaries always include both token totals, even when live Tokens or **Thinking time** is hidden or zero, and can be disabled without changing historical rows. They use the fixed high style and are inactive while Working line is disabled.

Classic and KITT move color across message and segments. **Animate spinner color** optionally includes spinner cells and separator. Static colors the full row uniformly and ignores text speed/spinner-color participation without changing saved values. Spinner glyph motion always remains active.

| Setting | Default | Presets | Applies to |
| --- | ---: | --- | --- |
| `spinnerIntervalMs` | 100 ms | Fast 60 / Normal 100 / Slow 160 / Custom | glyph motion |
| `textIntervalMs` | 60 ms | Fast 40 / Normal 60 / Slow 100 / Custom | Classic/KITT color motion |

Both speeds accept `30..1000` ms. Classic/KITT combine both cadences through one Pi Loader interval; exact cycles are used within 1024-frame/512-KiB limits. Pathological custom pairs use a bounded evenly distributed schedule with at most half a spinner-cycle and half a text-step rounding. Legacy `intervalMs` is accepted only as migration input for `spinnerIntervalMs` when the canonical field is absent.

Content reserves the complete Tokens label first, then Message, Thought, Elapsed, and Tool allocation, while preserving visual order **Message · Tool · Elapsed · Thought · Tokens** within the 80-column Loader-row contract. Active thought starts as `thinking 0s`; completed positive thought becomes `thought for Ns`. Rebuilds preserve spinner and visible color phase. Pi's working-row APIs are global and unkeyed, so another extension may win by writing last.

## Git status icons

| Icon | Meaning |
| --- | --- |
| `!` | Modified |
| `?` | Untracked |
| `+` | Staged |
| `✘` | Deleted |
| `»` | Renamed |
| `T` | Type changed (`icons.typechanged`) |
| `=` | Conflicted |
| `$` | Stashed |
| `↑` | Ahead |
| `↓` | Behind |
| `⇕` | Diverged |

## Runtime detection

Runtime/language modules use Starship Nerd Font symbols and defaults such as `bold green` for Node.js. Theme mode maps those styles through Pi; Footer terminal mode uses the terminal colorscheme's ANSI colors.

| Runtime/language | Detection examples |
| --- | --- |
| Buf | `buf.yaml`, `buf.gen.yaml`, `buf.work.yaml` |
| Bun | `bun.lock`, `bun.lockb` |
| C | `.c`, `.h` files |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp` files |
| CMake | `CMakeLists.txt`, `CMakeCache.txt` |
| COBOL | `.cbl`, `.cob` files |
| Conda | `CONDA_DEFAULT_ENV` environment |
| Crystal | `.cr` files, `shard.yml` |
| Dart | `.dart` files, `pubspec.yaml`, `.dart_tool/` |
| Deno | `deno.json`, `deno.jsonc`, `deno.lock` |
| .NET | `.csproj`, `.fsproj`, `global.json`, `Directory.Build.*` |
| Elixir | `mix.exs` |
| Elm | `.elm` files, `elm.json`, `elm-stuff/` |
| Erlang | `rebar.config`, `erlang.mk` |
| Fennel | `.fnl` files |
| Fortran | `.f`, `.f90`, `.f95`, `.f03`, `.f08`, `.f18`, `fpm.toml` |
| Gleam | `.gleam` files, `gleam.toml` |
| Go | `go.mod` |
| Gradle | `build.gradle`, `build.gradle.kts`, `gradle/` |
| Guix shell | `GUIX_ENVIRONMENT` environment |
| Haskell | `.hs`, `.cabal`, `stack.yaml`, `cabal.project` |
| Haxe | `.hx`, `.hxml`, `haxelib.json`, `.haxerc` |
| Helm | `helmfile.yaml`, `Chart.yaml` |
| Java | `.java-version` |
| Julia | `.jl` files, `Project.toml`, `Manifest.toml` |
| Kotlin | `.kt`, `.kts` files |
| Lua | `.lua` files, `stylua.toml`, `.luarc.json`, `lua/` directory |
| Maven | `pom.xml` |
| Meson | `MESON_DEVENV=1` and `MESON_PROJECT_NAME` |
| Mojo | `.mojo` files |
| Nim | `.nim`, `.nims`, `.nimble`, `nim.cfg` |
| Nix shell | `IN_NIX_SHELL=pure` or `IN_NIX_SHELL=impure` |
| Node.js | `package.json`, `.nvmrc`, `.node-version` |
| OCaml | `.opam`, `.ml`, `.mli`, `dune`, `_opam/`, `esy.lock/` |
| Odin | `.odin` files |
| OPA/Rego | `.rego` files |
| Perl | `.pl`, `.pm`, `Makefile.PL`, `cpanfile`, `META.*` |
| PHP | `composer.json` |
| Pixi | `pixi.toml`, `pixi.lock`, `PIXI_ENVIRONMENT_NAME` |
| Pulumi | `Pulumi.yaml`, `Pulumi.yml` |
| PureScript | `.purs` files, `spago.dhall`, `spago.yaml`, `spago.lock` |
| Python | `pyproject.toml`, `requirements.txt`, `setup.py`, `Pipfile` |
| R | `.R`, `.Rmd`, `.Rproj`, `DESCRIPTION`, `.Rproj.user/` |
| Raku | `.raku`, `.rakumod`, `.p6`, `.pm6`, `META6.json` |
| Red | `.red`, `.reds` files |
| Ruby | `Gemfile`, `.ruby-version` |
| Rust | `Cargo.toml` |
| Scala | `.scala`, `.sbt`, `build.sbt`, `.metals/` |
| Solidity | `.sol` files |
| Spack | `SPACK_ENV` environment |
| Swift | `.swift` files, `Package.swift` |
| Terraform | `.tf`, `.tfplan`, `.tfstate`, `.terraform/` |
| Typst | `.typ` files, `template.typ` |
| Vagrant | `Vagrantfile` |
| V | `.v` files, `v.mod`, `vpkg.json` |
| Xmake | `xmake.lua` |
| Zig | `.zig` files, `build.zig` |

## Pi fullscreen mode

Pi 0.84 adds a native fullscreen TUI with sticky Editor and Footer plus an independently scrollable transcript:

```json
{
  "tuiMode": "fullscreen"
}
```

Save this in Pi's `~/.pi/agent/settings.json`, select fullscreen in Pi's `/settings`, or use `--tui-mode fullscreen`. Zentui does not enable it automatically. Pi owns layout and scrolling while Zentui supplies configured components. Pi 0.80.5–0.83 remain supported for styling without native sticky placement.

## Compatibility and migration

Canonical `components` paths are the primary JSON interface. Component saves materialize canonical snapshots while retaining unknown user-owned fields and unknown future style data on disk. Unknown fields do not affect runtime behavior.

- Flat released inputs such as `editorStyle`, `features`, `footerFormat`, and `compactFooterFormat` remain accepted for migration.
- `components.footer.enabled` and `features.statusLine` migrate to Starship or Native when no valid Footer style exists; Hidden projects `features.statusLine: false`.
- `polished` and `polished-copy-friendly` are read-only aliases for `opencode` and `opencode-copy-friendly`.
- Legacy `features.copyFriendly` and old nested Editor/message `copyFriendly` fields are read-only migration inputs. Message copy-friendly `true` selects `framed-copy-friendly` rather than disabling rendering.
- Explicit Editor or User-message style saves remove only the corresponding obsolete nested flag. Raw released feature keys, unknown fields, and unknown style data remain preserved on disk.
- Explicit unsupported future style IDs are preserved on disk but fail open at runtime: Editor, User-message, and selector-border customization stay disabled, while Footer uses Native.
- Missing, empty, or malformed style values continue default and legacy migration behavior.

The flat properties returned by `mergeConfig`, `loadConfig`, and save helpers are deprecated compatibility output as of v0.20.2. They remain available throughout the 0.x release line; any removal requires a documented breaking release. This output deprecation is separate from accepted legacy flat JSON input.
