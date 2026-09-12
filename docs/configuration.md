# Zentui configuration reference

[Back to README](../README.md) · [Footer format template](./footer-format.md)

Zentui reads optional user configuration from `~/.pi/agent/zentui.json`. Missing or invalid known values fall back to defaults. Unknown fields are ignored at runtime but preserved on disk by component save operations where they are user-owned migration or future-style data.

## Start with minimal overrides

Do not copy the complete defaults into your file. Omitted fields keep defaults and source-aware inheritance. New installs enable Opencode Editor, Framed User messages, Zentui selector borders, and Starship Footer; Working line and Thinking (Experimental) are disabled.

Change just one surface:

```json
{
  "components": {
    "footer": { "colors": { "cwd": "bold green" } }
  }
}
```

To adopt only User messages while leaving the other default-enabled surfaces native or predecessor-controlled:

```json
{
  "components": {
    "editor": { "enabled": false },
    "userMessages": { "enabled": true, "style": "framed" },
    "selectorBorders": { "enabled": false },
    "footer": { "style": "native" }
  }
}
```

Native releases Zentui's ownership; Hidden deliberately installs a zero-row Footer. Disabling a component preserves its dormant preferences. See [color overrides and inheritance](#component-color-overrides-and-inheritance) and [explicit migration](#compatibility-and-migration) before snapshotting legacy settings.

## `/zentui` settings

The interactive `/zentui` menu is split into six component-oriented sections. Use `Tab` and `Shift+Tab` to switch sections. Selection/Change/Back/Close hints follow injected host keybindings (with older-host defaults when unavailable). Narrow help retains Change, Sections, and Back (on child pages) or Close guidance:

1. **Appearance** — component Preset; selector-border enablement, informational fixed style, and colors; icon mode.
2. **Editor** — enablement, style, colors, model label, border behavior, viewport indicators, settings for the selected editor style, and a static synthetic preview.
3. **User messages** — enablement, style, colors, and a static synthetic Markdown preview.
4. **Thinking (Experimental)** — private Rail, Tree, or Streaming rendering; active Streaming can switch live to Rail or Tree, Rail and Tree can switch live between each other, and the private renderer may break after Pi updates.
5. **Working line** — ownership, settled Turn summary, spinner and text speeds, optional spinner-color motion, text animation, color source, custom messages, Tool/Elapsed/Thinking time/Tokens segments, and animated preview.
6. **Footer** — Native, Starship, or Hidden. Starship additionally exposes colors, model label, responsive layout, separator, context style, and path display.
   - **Segments →** — visibility toggles for non-Git Starship segments.
   - **Git →** — Starship Footer Git segment and probe controls, not Editor Git controls.
   - **Extension statuses →** — Starship placement and color controls for active published keyed Footer statuses; not extension management or Working line integrations.

The three Footer child entries appear only with Starship selected. Child headings show their scope (for example, **Footer > Git**). The configured cancel key returns to Footer focused on the originating child entry; at the top level it still closes settings. `Tab` / `Shift+Tab` remain available on child pages to move to the next / previous top-level section relative to Footer. Visiting or backing out of a page does not save settings or change component ownership.

Editor, User messages, Thinking (Experimental), and Working line retain independent configuration. Editor, User-message, and Thinking previews remain visible while their component is disabled. Only the Working-line preview owns an animation timer. Starship-specific rows are shown only while Starship is selected. Footer Color overrides remain available for preconfiguration under every Footer style and say **Saved for Starship** when inactive. Native and Hidden hide the three child entries without changing their saved preferences. Other dormant choices explain their scope without rewriting values. Auto icons assume a Nerd Font without detecting one; ASCII replaces icons only, not all borders or UI glyphs.

Free-form values such as custom formats, Opencode metadata formats, and inactive extension keys remain JSON-only. Component raw colors are editable through each component’s **Color overrides** action, with explicit **Reset / inherit**. Working-line speed accepts validated custom milliseconds in `/zentui`.

Every section and Footer child page has a direct route and completion:

```text
/zentui appearance
/zentui editor
/zentui user-messages
/zentui thinking
/zentui working-line
/zentui footer
/zentui segments
/zentui git
/zentui extensions
```

`/zentui segments`, `/zentui git`, and `/zentui extensions` open the corresponding **Footer > …** child page when Starship is active. Under Native or Hidden, they instead open Footer with a requires-Starship explanation; they do not show active child controls, enable Starship, or write configuration.

`messages` and `thinking-steps` remain section aliases; Footer also accepts the aliases below. Useful slash-command shortcuts:

```text
/zentui migrate
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

### Component presets

Use the first **Appearance → Preset** row, or one of these exact commands:

```text
/zentui preset opencode
/zentui preset opencode-copy-friendly
/zentui preset rail
/zentui preset minimalist
```

| Preset ID | `components.editor` | `components.footer.style` | `components.userMessages` |
| --- | --- | --- | --- |
| `opencode` | `enabled: true`, `style: "opencode"` | `"starship"` | `enabled: true`, `style: "framed"` |
| `opencode-copy-friendly` | `enabled: true`, `style: "opencode-copy-friendly"` | `"starship"` | `enabled: true`, `style: "framed-copy-friendly"` |
| `rail` | `enabled: true`, `style: "accent-rail"` | `"starship"` | `enabled: true`, `style: "compact"` |
| `minimalist` | `enabled: true`, `style: "minimalist"` | `"hidden"` | `enabled: false` (style preserved) |

These are one-time, atomic selection patches, not ongoing profiles. Only the listed leaves are written, with the existing obsolete copy-friendly/Footer-enabled migration flags removed when their styles are explicitly selected. Colors and color sources, per-style options, icons, Footer segments/templates/path settings, all other components, and unknown fields remain untouched. Unsupported future style IDs are preserved unless the preset explicitly replaces that style; Minimalist even preserves an unsupported dormant message style. Existing legacy option resolution continues to work.

**Custom** is a derived display state, not a selectable preset or a saved key. Matching checks only the listed selection leaves, not colors/options or current runtime ownership; Minimalist ignores dormant message style. Unsupported active selected styles do not match. Hand-editing or individually changing a selection can show Custom; returning to a matching combination restores the preset label. No `preset` config key is used, and nothing is automatically reapplied on startup. New-install defaults remain unchanged and match Opencode.

The existing Minimalist editor stays enabled with its saved metadata/options. Disabled User messages releases only Zentui styling, leaving native or predecessor rendering intact. Hidden installs an owned zero-row Footer, whereas Native releases Zentui's Footer to Pi or a predecessor; `/zentui statusline disable` still selects Native, not Hidden.

Selecting presets keeps the settings panel open and preserves its focus. Config, Footer, and User messages update immediately; editor installation waits until the panel closes and Pi restores the draft. Only the latest editor settings are reconciled on exit, and shutdown cancels pending installation. With public editor-text APIs available, opening settings expands nonempty drafts before Pi snapshots them, preserving collapsed paste contents; this can move the cursor to the end and add an undo step. Empty drafts are untouched. Older hosts without these APIs retain Pi's existing draft-restoration behavior. Saves fail without changing active settings or overwriting corrupt/unreadable JSON. Live application reconciles only Editor, User messages, Footer, and dependent timers. Editor ownership restrictions are reported as saved-but-not-applied/reload-required; Footer host failures retain existing fail-open behavior. Direct preset commands also save in non-TUI modes without installing TUI components. Unknown IDs, missing IDs, and extra arguments do not change settings.

### Extension-status hyperlinks

An extension's **Original** color mode preserves SGR styling and HTTP/HTTPS
OSC 8 hyperlinks supplied by that extension. For example, set
`components.footer.styles.starship.extensionStatuses.colorModes.github-pr` to
`"original"` to retain a PR link from a GitHub status extension. Open it with
your terminal's link-opening gesture. Other URL schemes and unrelated terminal
controls (including clipboard, title, and cursor commands) are removed.

Zentui color mode continues to show plain status text. Zentui does not infer a
URL when an extension supplies only a label.

## Complete default configuration

Reference only—not a starter file. Prefer the minimal overrides above. Optional editor source-aware overrides such as `editorRail`, `editorGitBranch`, and `editorThinkingMax` are intentionally omitted.

<details>
<summary>Expand the complete defaults</summary>

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

</details>

## Core configuration

- Style values accept Starship/terminal strings such as `bold purple`, `fg:202`, `#89b`, `#89b4fa`, and `bg:blue fg:bright-green`, or Pi theme tokens such as `accent`, `borderMuted`, and `thinkingHigh`. Short `#rgb` values expand to `#rrggbb`.
- `projectRefreshIntervalMs` controls project-status polling. `0` disables polling. Values `1..4999` clamp to the five-second minimum; invalid or non-finite values use `30000`.
- `components.editor` owns Editor enablement, `opencode | opencode-copy-friendly | accent-rail | minimalist` style selection, color source, border mode, model label, viewport indicators, and all four style configurations.
- Editor `modelLabel` uses `id` by default; `name` uses the display name with ID fallback. Footer has an independent `modelLabel` control.
- `components.userMessages` owns User-message enablement, `framed | framed-copy-friendly | compact | labeled` style selection, and color source. Disabling it delegates byte-for-byte to Pi's native renderer.
- `components.thinkingSteps` independently owns opt-in **Thinking (Experimental)** display. It defaults to `{ "enabled": false, "mode": "tree" }`; canonical modes are `rail | tree | streaming`. The former persisted `streaming-experimental` value is accepted only as a migration alias and is normalized to `streaming` on save.
- All three modes decorate Pi's private host renderer and are tested on exact Pi versions 0.80.5, 0.82.1, 0.83.0, 0.84.0, 0.84.4, and 0.85.1. Active Streaming can switch live to Rail or Tree, and Rail and Tree can switch live between each other. Entering Streaming from a structural mode, first enable, and re-enable after live disable require restart; live disable restores native thinking. Disabled mode changes only preconfigure.
- `components.workingLine.enabled` is the sole Working-line ownership switch. Thinking (Experimental) never enables, configures, or owns the Working line and leaves the existing **Thinking time** option unchanged.
- `components.selectorBorders` owns selector-border enablement, fixed `zentui` style, and color source. Disable it for native Pi behavior.
- `components.footer` owns `native | starship | hidden` style selection, color source, model label, and Starship options. Hidden installs an empty component with zero rows.
- Starship's package-version segment reads the project manifest and is distinct from the runtime segment, which reports the installed toolchain.
- Active third-party statuses from `ctx.ui.setStatus()` can be placed left, middle, or right, hidden per key, and assigned independent color modes.
- The shown `editor*` colors match the default `theme` source. Omit them to preserve source-aware defaults when switching between `theme` and `terminal`.

### Footer layout authority

Under `components.footer.styles.starship`, `segments` toggles choose the **built-in wide layout** when `format` is empty. An explicit wide `format` chooses its own variables instead. With `responsive` enabled, Zentui tries the wide layout, then reflows it, then uses the independent `compactFormat` template if it still cannot fit. `compactMaxLines` limits compact rows, not their segment selection.

Templates can show a disabled built-in segment or omit an enabled one: disabling Current directory and enabling Session cost can hide cwd and show cost at wide widths, while the default compact template still shows `$cwd` and omits `$cost`. Edit `format` or `compactFormat` to change those templates; `/zentui format clear` resets only the wide layout. Git counts remain a formatting choice for git-status values in both built-in and template layouts. `/zentui` segment descriptions disclose these boundaries; toggles never rewrite templates.

### Footer path display

`components.footer.styles.starship.pathDisplay.mode` accepts `basename`, `full`, or the opt-in `repository`; the unchanged default is `basename`. Repository mode removes the repository directory name: at `/repo` it renders `.`, and at `/repo/extensions/zentui` it renders `extensions/zentui`. Zentui finds the nearest ancestor with a `.git` directory or worktree `.git` file without starting an extra Git process.

For `full` and `repository`, `depth` is the number of final components to retain. `0` is unlimited. Repository mode first creates the path relative to the repository root, then applies depth, so `/repo/packages/core/src` with `depth: 2` renders `…/core/src`; repository root remains `.` at every depth. `/zentui` exposes **Repository** as a separate Footer path-display choice and keeps the depth control for both modes.

Repository roots are associated with the cwd that produced them. While the current root is missing, stale, outside the cwd, still being refreshed, or unavailable after a lookup failure or Git-to-non-Git transition, Zentui silently renders the unlimited `full` path, including `~` home abbreviation. Built-in and custom `$cwd` layouts use the same result at wide and compact widths. These options belong only to the Starship Footer; Minimalist Editor path semantics are unchanged.

### Component color overrides and inheritance

Use sparse `components.<owner>.colors` objects to change only one surface:

```json
{
  "colors": { "editorAccent": "blue", "cwdText": "bold cyan" },
  "components": {
    "editor": { "colors": { "accent": "fg:202", "gitBranch": "bold blue" } },
    "userMessages": { "colors": { "accent": "", "border": "bright-black" } },
    "selectorBorders": { "colors": { "border": "borderMuted" } },
    "footer": { "colors": { "cwd": "bold green" } },
    "workingLine": { "colors": { "high": "bold cyan" } }
  }
}
```

Resolution is **component override → historical shared `colors` fallback → existing selected-source default**, both before and after explicit migration. Absent overrides preserve historical output. Shared colors remain optional live fallbacks indefinitely: changing a shared fallback can affect every owner that still inherits it. An override never changes another owner or its color source. There is no generated palette or resolved ANSI snapshot in these objects.

Empty strings and whitespace-only strings mean deliberately **unstyled**, not missing. **Reset / inherit** deletes the local key; hand-deleting a key does the same. Unsupported values are ignored at runtime, while invalid and unknown future JSON keys remain preserved on disk. The settings editor validates supported style strings, distinguishes Escape from an empty submission, and offers role selection within one **Color overrides** action per component (selector borders use Appearance). Thinking (Experimental) has no raw color object or control.

| Owner | Local keys | Historical shared fallback |
| --- | --- | --- |
| `footer` | `cwd`, `sessionName`, `gitBranch`, `gitStatus`, `contextNormal`, `contextWarning`, `contextError`, `cost`, `sessionDuration`, `tokens`, `separator`, `runtimePrefix`, `extensionStatus`, `packageVersion`, `gitCommit`, `gitMetricsAdded`, `gitMetricsDeleted`, `username`, `time`, `os` | Same-named shared key |
| `editor` | `cwd`, `sessionName`, `gitStatus`, `contextNormal`, `contextWarning`, `contextError`, `cost`, `sessionDuration` | Same-named shared key; these are Minimalist metadata roles |
| `editor` | `gitBranch` | `editorGitBranch`, then explicitly configured shared `gitBranch` / `git`; never the generated Footer branch default |
| `editor` | `accent`, `border`, `prompt`, `rail`, `model`, `provider`, `thinking`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh`, `thinkingMax` | `editorAccent`, `editorBorder`, `editorPrompt`, `editorRail`, `editorModel`, `editorProvider`, `editorThinking`, and matching `editorThinking*` level keys |
| `userMessages` | `accent`, `border` | `editorAccent`, `editorBorder` |
| `selectorBorders` | `border` | No shared raw key: defaults to theme `borderMuted` / terminal `bright-black`; never inherits `editorBorder` |
| `workingLine` | `low`, `mid`, `high` | `workingLineLow`, `workingLineMid`, `workingLineHigh` |

Shared aliases `cwdText → cwd` and `git → gitBranch` remain accepted. Footer model/provider are plain text and the detected runtime label uses its runtime module's style, not invented Footer color keys.

Role-specific defaults and chains remain intact:

- Copy-friendly Opencode prompt uses explicit prompt → configured accent → the existing theme `accent` / terminal `blue` fallback. Model's constant fallback does **not** inherit a configured accent. Minimalist retains its distinct model/thinking defaults.
- Accent Rail uses only `rail` / `editorRail`, then warm theme `syntaxNumber` / terminal `215`; it does not inherit `accent`.
- Minimalist branch defaults to theme `bold syntaxKeyword` / terminal `bold blue` when no local or explicit shared branch style exists.
- Thinking levels use their level key then generic `thinking`; Max uses `thinkingMax → thinkingXhigh → thinking`. Static metadata and adaptive borders retain their existing distinct fallback behavior; theme-adaptive borders still defer to Pi's thinking-border callback.
- Working-line defaults remain theme `dim`, `muted`, `bold accent`, or terminal `bright-black`, `cyan`, `bold cyan`. Both animated rows and summaries consume local overrides. New persisted Turn summaries snapshot the effective high style; when no safe SGR prefix exists (including an unstyled high override), they retain the safe bold-cyan substitute. Existing persisted summaries keep their recorded style; legacy version-1 summaries use current high styling.

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

Model variables use Editor `colors.model` (legacy `editorModel`), provider uses `colors.provider` (legacy `editorProvider`), and thinking uses the matching Editor level style. Literal text, session name, and usage metadata use the neutral editor-border theme style. ANSI/VT sequences, controls, and line-breaking whitespace are sanitized without collapsing ordinary spaces.

Missing, non-string, or empty values use `$model  $provider(  $thinking)`. A non-empty format that resolves to no metadata preserves the normal blank spacer and metadata rows. This option is JSON-only; `/zentui format` controls the Footer.

## User-message styles

- `framed` preserves a full-width bordered box with an accent rail.
- `framed-copy-friendly` keeps full-width horizontal borders and spacer rows, removes the copied rail, and retains a one-cell leading gutter.
- `compact` uses only an accent rail with no surrounding border or padding rows.
- `labeled` uses a rounded box with fixed label `User`.
- Disabling styling delegates to Pi's native renderer; native is not a style ID.
- Zentui intentionally provides no custom `plain` style.

## Thinking (Experimental)

Rail, Tree, and Streaming share one private `AssistantMessageComponent` wrapper. The saved `{ enabled, mode }` value is read at session start before transcript restoration; disabled startup installs nothing. Once installed and healthy, active Streaming can switch live to Rail or Tree, and Rail and Tree can switch live between each other, without reinstalling the patch. Each supported transition rerenders tracked components once. Selecting Streaming from Rail or Tree saves Streaming but keeps the active structural mode unchanged and reports restart required; it never acquires input or timer resources live. Leaving Streaming releases those resources. If cleanup throws, a requested Rail or Tree mode still becomes active, while disable still restores native children; either successful change warns that Streaming is unavailable for the rest of the session. Entering Streaming from a structural mode, first enable, and re-enable after a live disable require restart, while mode changes when disabled only preconfigure. Shutdown restores native children, exact hidden-state ownership, and the predecessor descriptor. Startup acquisition or private constructor, layout, Markdown identity, parser, theme, rendering, width, or displacement failure uses native thinking. Private APIs may break after any Pi update.

Rail parses each native contiguous thinking run and shows every label in that run. Tree shows the latest five in each run; neither aggregates across intervening text or tool blocks. Both follow Pi's thinking visibility. Labels come from headings, top-level list items, and blank-line-separated prose. Complete strict 7-bit CSI SGR styling is stripped before parsing; every other terminal control, unsafe or unstructured content, malformed or over-limit input, unterminated fences/math, and unsupported structure leave that complete run native. Fenced code, Mermaid, display math, and indented nested content remain opaque bodies.

Each selected SGR-free label is rendered as Markdown by a fresh Pi `Markdown` with the host child's exact theme, default `thinkingText`/italic style, and transform options. Native emphasis, code, links, HTML, LaTeX, and custom theme/transform callbacks therefore remain authoritative. Host horizontal padding is applied externally. Each label is exactly one terminal row; Pi TUI's ANSI/OSC/grapheme-aware width utilities crop the first rendered row and reserve one cell for `…` only when required. Empty, image, non-text, impossible-width, or throwing output restores the whole native run. Connectors are separate from Markdown and call the current `theme.fg("accent", connector)` every render, so custom themes directly control their appearance. Visible forms are:

```text
│ Thinking       ┆ Thinking
│ First          ├─ · Earlier
│ Latest         └─ · Latest
│ • Open         └─ • Open
```

Only an actually open thinking phase uses `•`; a text/tool transition or restored completion is settled. Rail and Tree preserve Pi's hidden state and native hidden label. The `/zentui` Mode action offers all three modes, but entering Streaming from Rail or Tree is saved for restart rather than applied live.

Streaming keeps the reviewed host-rendered behavior: while open it shows the latest five rendered terminal rows beneath `Thinking 7.1s`; completion folds under `Thought` or current-session `Thought for Ns`. Restored entries have no duration because Pi does not persist a reliable thinking-end timestamp. Only a session started in active Streaming owns its validated configured `app.thinking.toggle` binding and one-second timer. Ctrl+T expands/refolds native reasoning. Startup resource failures and private-shape/render failures use complete native thinking. A cleanup callback that throws while leaving Streaming is contained: Rail or Tree remains active, while Streaming becomes unavailable for that session. Component and timing tracking are bounded to 256; evicted entries are restored natively first.

The exact all-mode private matrix covers Pi 0.80.5, 0.82.1, 0.83.0, 0.84.0, 0.84.4, and 0.85.1 under dark, light, and current themes, narrow/wide widths and resize; Pi 0.84.4 also has a fullscreen live-transition PTY smoke. Thinking (Experimental) never owns or writes the Working line, including its unchanged **Thinking time** option, and does not own Footer, Editor, widgets, statuses, or model behavior.

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

Content reserves the complete Tokens label and active extension segments first, then Message, Thought, Elapsed, and Tool allocation, while preserving visual order **Message · Tool · Elapsed · Thought · Tokens · Extensions** within the 80-column Loader-row contract. Active thought starts as `thinking 0s`; completed positive thought becomes `thought for Ns`. Rebuilds preserve spinner and visible color phase. Pi's working-row APIs are global and unkeyed, so another extension may win by writing last.

### Working-line extension integration

Third-party extensions can add dynamic text to Zentui's owned Working line through Pi's shared event bus. Protocol version 1 uses keyed segments that are sanitized, ordered by key, width-bounded, and included in the same Classic/KITT animation frames as Zentui's built-in content.

Probe the capability when an interaction starts so an extension can fall back to Pi's public `setWorkingMessage()` slot when Zentui's Working line is unavailable:

```typescript
const capability = { supported: false, active: false };
pi.events.emit("zentui:working-line-segment-capability", capability);

if (capability.active) {
  pi.events.emit("zentui:working-line-segment", {
    key: "@scope/my-extension:throughput",
    text: "24.3 tok/s · TTFT 820ms",
  });
}
```

Update a segment by emitting the same key with new text. Remove it when the interaction settles or the publishing extension shuts down:

```typescript
pi.events.emit("zentui:working-line-segment", {
  key: "@scope/my-extension:throughput",
  text: undefined,
});
```

All publishers share one global key namespace. Collisions are last-update-wins, and removal by either publisher removes the value for that key. Publishers must therefore use stable, package-qualified keys such as `@scope/package:segment`; each publisher owns removal and lifecycle cleanup for its keys. `text: ""` also removes a segment. Published state is scoped to the current session and Working-row ownership: Zentui discards it on a new session, disable, shutdown, or ownership release. Positive updates while capability is inactive are ignored rather than retained, so publishers must probe again and republish their current value after capability becomes active.

Zentui accepts at most 16 unique keys, keys up to 64 code units, and values up to 256 code units. Extra segments are omitted or truncated when the complete row reaches its fixed width. `supported` reports whether this Zentui version understands the protocol. Zentui also adds `version: 1` to the mutable capability response; probes that initialize only `supported` and `active`, as above, remain compatible. `active` additionally requires an enabled Working line in an active TUI session where Zentui successfully installed and still claims both required Pi working-row surfaces. Pi's unkeyed, last-writer-wins APIs provide no way to prove that another extension has not overwritten a surface after installation, so publishers should probe at each interaction and retain their normal fallback.

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

Canonical `components` paths are the primary JSON interface. Ordinary component saves snapshot and normalize **only the edited owner**: that owner's current legacy-derived selections, sources, and style options become explicit, while unrelated raw JSON values and future styles remain untouched and legacy-derived. Unknown fields do not affect runtime behavior. Color overrides stay sparse and unrelated raw color values are never normalized on save.

Run **`/zentui migrate`** or **Appearance → Migrate component selections** for a separate, explicitly confirmed all-owner snapshot. The confirmation explains that component selections, color sources, and style options are frozen against future shared/root legacy selection edits, while shared raw color inheritance remains active. Migration reads the latest disk file after confirmation, preserves unknown fields, aliases and templates, writes atomically (including through a valid symlink), and is idempotent. It never copies generated color defaults or resolved ANSI into owner overrides. Cancellation, unavailable UI, stale session dialogs, corrupt/unreadable config, and failed atomic writes do not change the config. There is **no automatic startup or first-edit migration** and no version marker.

Snapshot saves remove the edited owners' obsolete nested copy-friendly/Footer-enabled flags after capturing their effective choices. Deliberately reintroducing an owner-local legacy alias is still an edit to that owner: for example, `components.userMessages.styles.framed.copyFriendly` retains its documented alias behavior with `style: "framed"`. This is distinct from shared/root legacy recoupling, which canonical snapshots prevent.

Legacy coupled saver APIs remain explicit multi-owner compatibility transactions; ordinary settings controls never use them. Presets remain sparse, selection-only combinations rather than migrations.

- Flat released inputs such as `editorStyle`, `features`, `footerFormat`, and `compactFooterFormat` remain accepted for migration.
- `components.footer.enabled` and `features.statusLine` migrate to Starship or Native when no valid Footer style exists; Hidden projects `features.statusLine: false`.
- `polished` and `polished-copy-friendly` are read-only aliases for `opencode` and `opencode-copy-friendly`.
- Legacy `features.copyFriendly` and old nested Editor/message `copyFriendly` fields are read-only migration inputs. Message copy-friendly `true` selects `framed-copy-friendly` rather than disabling rendering.
- Explicit Editor or User-message style saves remove only the corresponding obsolete nested flag. Raw released feature keys, unknown fields, and unknown style data remain preserved on disk.
- Explicit unsupported future style IDs are preserved on disk but fail open at runtime: Editor, User-message, and selector-border customization stay disabled, while Footer uses Native.
- Missing, empty, or malformed style values continue default and legacy migration behavior.

The flat properties returned by `mergeConfig`, `loadConfig`, and save helpers are deprecated compatibility output as of v0.20.2. They remain available throughout the 0.x release line; any removal requires a documented breaking release. This output deprecation is separate from accepted legacy flat JSON input.
