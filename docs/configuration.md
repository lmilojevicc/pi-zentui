# Zentui configuration reference

[Back to README](../README.md) · [Footer format template](./footer-format.md)

Zentui reads optional user configuration from `~/.pi/agent/zentui.json` in Pi, or `~/.omp/agent/zentui.json` in Oh My Pi. The active host/profile agent-directory override is respected. Missing or invalid known values fall back to defaults. Unknown fields are ignored at runtime but preserved on disk by component save operations where they are user-owned migration or future-style data.

## Refresh and cache freshness

- Settings telemetry checks file signatures on each demanded sync, including inode, size, modification and change times. Ordinary edits, replacements and trust changes reload the snapshot; untrusted project settings are never inspected. Signature equality assumes normal filesystem metadata updates, not content hashing. Read failures retry.
- Session usage reuses one event-owned snapshot under Pi's append-only session contract. Session/leaf changes and message, agent, settlement, tree and compaction boundaries refresh totals. Silent same-leaf history edits outside those boundaries are not detected by this fast path; the generic usage helper remains mutation-safe.
- Repository path rendering uses the latest controlled project refresh. Creating or removing a `.git` marker becomes visible on the next demanded event, explicit or interval refresh, not every render. Disabling polling leaves event/explicit refreshes active.
- Runtime and package discovery share one asynchronous filesystem snapshot per refresh; manifests are read fresh. Runtime versions retain the bounded 32-project cache, 60-second successful-version lifetime and 5-second failure retry, with marker and environment changes invalidating earlier results.
- Footer syntax uses a 32-entry exact-format cache. Format and alias edits are observed immediately; theme, width, status and quota output are never cached with syntax.

Disabled, native and unowned surfaces do not demand these probes on behalf of Zentui. Pi and other extensions may perform their own work.

## Start with minimal overrides

Do not copy the complete defaults into your file. Omitted fields keep defaults and source-aware inheritance. New installs enable Opencode Editor, Framed User messages, Zentui selector borders, Starship Footer, and Working line with Border placement; Thinking (Experimental) is disabled. All presets inherit these Working-line defaults without overriding saved choices.

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

Native releases Zentui's ownership; Hidden hides Footer metrics, path, and model segments but keeps allowed extension statuses on one line below the editor. With no nonempty allowed statuses, it renders no rows. Disabling a component preserves its dormant preferences. See [color overrides and inheritance](#component-color-overrides-and-inheritance) and [explicit migration](#compatibility-and-migration) before snapshotting legacy settings.

## `/zentui` settings

The interactive `/zentui` menu is split into seven component-oriented sections. Use `Tab` and `Shift+Tab` to switch sections. Selection/Change/Back/Close hints follow injected host keybindings (with older-host defaults when unavailable). Narrow help retains Change, Sections, and Back (on child pages) or Close guidance:

1. **Appearance** — component Preset; selector-border enablement, informational fixed style, and colors; icon mode.
2. **Editor** — enablement, style, colors, Codex quota, model label, border behavior, viewport indicators, settings for the selected editor style, and a static synthetic preview.
3. **User messages** — enablement, style, colors, and a static synthetic Markdown preview.
4. **Thinking (Experimental)** — private Rail, Tree, or Streaming rendering; active Streaming can switch live to Rail or Tree, Rail and Tree can switch live between each other, and the private renderer may break after Pi updates.
5. **Working line** — ownership, settled Turn summary, spinner and text speeds, optional spinner-color motion, text animation, color source, custom messages, Tool/Elapsed/Thinking time/Tokens/Token rate segments, and animated preview.
6. **Footer** — Native, Starship, or Hidden. Starship additionally exposes colors, Codex quota, model label, responsive layout, separator, context style, and path display.
   - **Segments →** — visibility toggles for non-Git Starship segments.
   - **Git →** — Starship Footer Git segment and probe controls, not Editor Git controls.
7. **Extension statuses** — one Default placement and each observed/saved extension's placement and color. Off controls visibility; positions are saved per Footer mode.

The two Footer child entries appear only with Starship selected. Child headings show their scope (for example, **Footer > Git**). The configured cancel key returns to Footer focused on the originating child entry; at the top level it still closes settings. `Tab` / `Shift+Tab` remain available on child pages to move to the next / previous top-level section relative to Footer. Visiting or backing out of a page does not save settings or change component ownership.

Editor, User messages, Thinking (Experimental), and Working line retain independent configuration. Editor, User-message, and Thinking previews remain visible while their component is disabled. Only the Working-line preview owns an animation timer. Footer’s Starship-specific rows are shown only while Starship is selected; Extension statuses offers the same unprefixed placement/color rows in every Footer style. Native saves dormant Starship position/color preferences without changing Pi's layout. Footer Color overrides remain available for preconfiguration under every Footer style and say **Saved for Starship** when inactive. Native and Hidden hide the two child entries without changing their saved preferences. Other dormant choices explain their scope without rewriting values. Auto icons assume a Nerd Font without detecting one; ASCII replaces icons only, not all borders or UI glyphs.

Free-form values such as custom formats, Opencode metadata formats, and previously unseen, unsaved extension keys remain JSON-only. Component raw colors are editable through each component’s **Color overrides** action, with explicit **Reset / inherit**. Editor and Starship Footer also offer **Individual custom value colors**, listing current publishers, valid alias targets, and saved publisher overrides. Working-line speed accepts validated custom milliseconds in `/zentui`.

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

`/zentui segments` and `/zentui git` open the corresponding **Footer > …** child page when Starship is active. Under Native or Hidden, they instead open Footer with a requires-Starship explanation; they do not show active child controls, enable Starship, or write configuration. `/zentui extensions` always opens the independent Extension statuses section.

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

The existing Minimalist editor stays enabled with its saved metadata/options. Disabled User messages releases only Zentui styling, leaving native or predecessor rendering intact. Hidden owns a status-only Footer (no rows when no allowed statuses remain), whereas Native releases Zentui's Footer to Pi or a predecessor; `/zentui statusline disable` still selects Native, not Hidden.

Selecting presets keeps the settings panel open and preserves its focus. Config, Footer, and User messages update immediately; editor installation waits until the panel closes and Pi restores the draft. Only the latest editor settings are reconciled on exit, and shutdown cancels pending installation. With public editor-text APIs available, opening settings expands nonempty drafts before Pi snapshots them, preserving collapsed paste contents; this can move the cursor to the end and add an undo step. Empty drafts are untouched. Older hosts without these APIs retain Pi's existing draft-restoration behavior. Saves fail without changing active settings or overwriting corrupt/unreadable JSON. Live application reconciles only Editor, User messages, Footer, and dependent timers. Editor ownership restrictions are reported as saved-but-not-applied/reload-required; Footer host failures retain existing fail-open behavior. Direct preset commands also save in non-TUI modes without installing TUI components. Unknown IDs, missing IDs, and extra arguments do not change settings.

### Extension-status visibility

`/zentui extensions` is available with Native, Hidden, or Starship Footer. It shows **Default placement**, then each observed or saved extension's **placement** and **color** (Original, Zentui). Both placement controls offer only Left, Middle, Right, Off, in that order. No separate visibility rows or mode prefixes are shown. Unset or inherited placements display their effective position or Off, not a selectable Default value. Off hides statuses via `components.extensionStatuses`; a positive per-extension placement explicitly shows that key even when the default is Off. Choices save atomically; merely opening the panel does not rewrite config:

```json
{
  "components": {
    "extensionStatuses": {
      "defaultVisibility": "show",
      "visibility": { "github-pr": "hide" }
    }
  }
}
```

Off suppresses observed publications through Pi's public `setStatus` method. A visible choice passes the original text through; the current Footer still controls rendering. Hidden renders nonempty allowed statuses on one minimal line below the editor, preserving incoming colors by default and Pi's key ordering within each placement, with safe single-line text and width truncation. Default Off hides inherited keys; per-key Off hides that key. No remaining statuses means no blank row. Starship's local `off` placement still omits a shown status only in Starship, never in Hidden. Starship placement/color preserve their existing Footer-owned preferences; they do not route or recolor Hidden or native/third-party footers. Native positive placements save dormant Starship preferences and Show visibility but never move Pi's native statuses. Historical Starship `off` settings never become global Off in Native or Hidden.

With Hidden selected, default placement starts at Left. To restore inheritance in config, remove the key's visibility and Hidden placement overrides; its color can remain saved. These sparse preferences live in `components.extensionStatuses.hidden`, independently of Starship and visibility:

```json
{
  "components": {
    "extensionStatuses": {
      "hidden": {
        "defaultPlacement": "left",
        "placements": { "github-pr": "right", "sync": "middle" },
        "colorModes": { "github-pr": "zentui" }
      }
    }
  }
}
```

Each color under Hidden offers Original (the default) or Zentui. Original keeps the extension's supplied styling and safe links. Zentui shows plain text in the active Pi theme's `muted` color, independently of Starship's palette and color-source settings. Choices are saved in `components.extensionStatuses.hidden.colorModes`; selecting Original removes only that key's override. Color changes do not alter visibility or placement.

Left and Right anchor to the edges; Middle is terminal-centered, then clamped between them. Crowded zones share space fairly and truncate safely with at least one separating cell. At widths too narrow for all zones, Left, Middle, then Right take priority. Original mode preserves incoming styles and safe links; resets prevent colors/backgrounds/links from leaking into padding or another status. Off and explicit positions change visibility; no choice changes Footer style. Hidden never inherits Starship's `off`, placement, or colors. Switching Footer style retains both sets of preferences; Native keeps native positioning.

Discovery is best-effort and session-scoped: observed raw keys and saved visibility/Hidden/Starship keys remain editable, with already-owned Starship or Hidden Footer data supplementing discovery only, never suppression/replay provenance. Hidden also applies visibility to those provider statuses when rendering; it does not republish them. Zentui never installs a Footer just to discover statuses. **No observed statuses** does not mean no extensions are running. Publications before observation, cached setters, separate UI contexts, and nondelegating successor extensions may bypass these controls. Unsupported/frozen setter shapes fail open. Cleanup restores only safely owned suppression and does not overwrite a successor setter or replay uncertain stale values. This controls keyed status visibility, not extension enablement or Working-line integrations.

### Extension-status hyperlinks

An extension's **Original** color mode preserves SGR styling and HTTP/HTTPS
OSC 8 hyperlinks supplied by that extension. For example, set
`components.footer.styles.starship.extensionStatuses.colorModes.github-pr` to
`"original"` to retain a PR link from a GitHub status extension. Hidden's color choice is separate, under `components.extensionStatuses.hidden.colorModes`, and defaults to Original. Open it with
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
      "codexQuota": false,
      "style": "opencode",
      "colorSource": "terminal",
      "borderColorMode": "static",
      "modelLabel": "id",
      "viewportIndicators": true,
      "styles": {
        "opencode": {
          "metadataFormat": "$model  $provider(  $thinking)(  $fast_mode)(  $codex_quota)",
          "completionMenu": "palette"
        },
        "opencode-copy-friendly": {
          "metadataFormat": "$model  $provider(  $thinking)(  $fast_mode)(  $codex_quota)",
          "completionMenu": "palette"
        },
        "accent-rail": {
          "rail": "▎",
          "asciiRail": "|",
          "transparent": false
        },
        "minimalist": {
          "formats": {
            "bottomLeft": "$session_name$join_sep($git_branch)"
          },
          "pathDisplay": "compact",
          "contextFormat": "percent-total",
          "contextGauge": false,
          "showSessionName": false,
          "showTimer": false,
          "showCost": true,
          "showCacheHit": false,
          "showGit": true,
          "contextThresholds": {
            "warning": 70,
            "error": 90
          },
          "separator": "dash"
        }
      }
    },
    "userMessages": {
      "enabled": true,
      "style": "framed",
      "colorSource": "terminal",
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
      "enabled": true,
      "placement": "border",
      "turnSummary": true,
      "turnSummaryFormat": "Turn took $turn_duration$join_sep(thought for $thought_duration)$join_sep(↑$input_tokens ↓$output_tokens)$join_sep$token_rate",
      "spinner": "star-bloom",
      "spinnerIntervalMs": 100,
      "animateSpinnerColor": false,
      "textIntervalMs": 60,
      "textAnimation": "classic",
      "colorSource": "terminal",
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
        "tokens": true,
        "tokenRate": true
      }
    },
    "extensionStatuses": {
      "defaultVisibility": "show",
      "visibility": {}
    },
    "selectorBorders": {
      "enabled": true,
      "style": "zentui",
      "colorSource": "terminal"
    },
    "footer": {
      "style": "starship",
      "codexQuota": false,
      "colorSource": "terminal",
      "modelLabel": "id",
      "styles": {
        "starship": {
          "format": "",
          "responsive": true,
          "compactFormat": "$cwd$wrap(in $session_name)$wrap(on $git_branch) $git_status$wrap$context$wrap_sep$tokens$wrap_sep($codex_quota)",
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
    "os": "bold white"
  }
}
```

</details>

## Core configuration

- Style values accept Starship/terminal strings such as `bold purple`, `fg:202`, `#89b`, `#89b4fa`, and `bg:blue fg:bright-green`, or Pi theme tokens such as `accent`, `borderMuted`, and `thinkingHigh`. Short `#rgb` values expand to `#rrggbb`.
- `projectRefreshIntervalMs` controls project-status polling, not opt-in quota refresh. `0` disables project polling. Values `1..4999` clamp to the five-second minimum; invalid or non-finite values use `30000`.
- `components.editor` owns Editor enablement, `opencode | opencode-copy-friendly | accent-rail | minimalist` style selection, color source, border mode, model label, viewport indicators, and all four style configurations.
- Editor `modelLabel` uses `id` by default; `name` uses the display name with ID fallback. Footer has an independent `modelLabel` control.
- `components.userMessages` owns User-message enablement, `framed | framed-copy-friendly | compact | labeled` style selection, and color source. Disabling it delegates byte-for-byte to Pi's native renderer.
- `components.thinkingSteps` independently owns opt-in **Thinking (Experimental)** display. It defaults to `{ "enabled": false, "mode": "tree" }`; canonical modes are `rail | tree | streaming`. The former persisted `streaming-experimental` value is accepted only as a migration alias and is normalized to `streaming` on save.
- All three modes decorate Pi's private host renderer and are tested on exact Pi versions 0.85.0, 0.87.1, and 1.0.3. Active Streaming can switch live to Rail or Tree, and Rail and Tree can switch live between each other. Entering Streaming from a structural mode, first enable, and re-enable after live disable require restart; live disable restores native thinking. Disabled mode changes only preconfigure.
- `components.workingLine.enabled` is the sole Working-line ownership switch. Thinking (Experimental) never enables, configures, or owns the Working line and leaves the existing **Thinking time** option unchanged.
- `components.workingLine.placement` (`above | border`) selects a floating row or the Minimalist/Opencode top border (default). Accent Rail supports only Above. Disabled, native, unavailable, or unsafe/narrow editors and Pi versions without working-row visibility control fall back to Above without changing saved choices. Legacy `input` normalizes to `above`; the prompt remains available for typing.
- `components.selectorBorders` owns selector-border enablement, fixed `zentui` style, and color source. Disable it for native Pi behavior.
- `components.footer` owns `native | starship | hidden` style selection, color source, model label, and Starship options. Hidden hides its main segments, retaining only allowed extension statuses; an empty status line occupies no rows.
- Starship's package-version segment reads the project manifest and is distinct from the runtime segment, which reports the installed toolchain.
- `components.extensionStatuses` independently controls Show/Hide for observed `ctx.ui.setStatus()` publications. It also owns Hidden-only placement under `hidden`; Starship retains its own placement and color modes.
- Editor, User messages, Footer, selector borders, and Working line default to `terminal` colors. Explicit saved `theme` choices remain unchanged. Omit optional `editor*` overrides to preserve source-aware defaults.

### Codex account quota

`components.editor.codexQuota` and `components.footer.codexQuota` are independent booleans, both `false` by default. Enable either from its **Codex quota** settings row, or merge these leaves into your existing file:

```json
{
  "components": {
    "editor": { "codexQuota": true },
    "footer": { "codexQuota": false }
  }
}
```

This example enables only Editor quota, without changing any component's style or enablement. Minimalist with Hidden Footer is supported. Footer quota requires Starship. Neither toggle enables another surface or changes a color source, and presets preserve both choices.

- Only the exact active provider `openai-codex` with native Codex API and ChatGPT-origin model/provider routing is eligible, not `openai`, proxies (including same-ID overrides), or similarly named models. Resolved-auth routing overrides must also use the ChatGPT origin. Use Pi's existing ChatGPT/Codex login; API billing balances are not supported.
- Values are **remaining**, rounded percentages: `5h 80% | week 60%`. Only exact 18,000-second and 604,800-second windows are recognized, independently of response ordering. Other durations stay unknown rather than acquiring incorrect labels.
- `--` means unavailable, including a missing window, unsupported auth API/account, or no successful request. `0%` means exhausted. A newer partial response replaces the previous snapshot completely.
- Transient HTTP/network/schema failures and refresh deadlines (including slow authentication lookups) retain successful values with a textual `stale` warning. Values older than two minutes also become stale. Missing, failed, or rejected authentication clears the cache, as do account changes, provider changes, loss of all consumers, and teardown. Credentials and quota are never persisted by Zentui.
- One shared poller refreshes roughly every minute, including idle time, only in a TUI session with an owned, enabled eligible consumer. Both toggles off means no quota auth lookup or request. Editor templates without `$codex_quota` do not create demand; Footer considers both wide and responsive compact paths. HTTP 429 can delay the next request via `Retry-After`. Each refresh has a ten-second deadline; late uncancelable auth results are ignored.
- Opencode variants include quota conditionally in their shipped metadata defaults. Minimalist adds it beside context when space allows. Accent Rail adds one editor-owned row beneath input and viewport indicators, before autocomplete. At narrow widths quota is omitted as a unit rather than clipping away labels or `stale`. Input text and Working line are unaffected.
- Quota reuses the selected component's `contextNormal`, `contextWarning`, and `contextError` color roles. Remaining quota at or below 50% uses warning, at or below 20% uses error; stale values use at least warning. Editor never borrows Footer overrides. Settings previews use synthetic values only.

**Custom templates remain authoritative.** Saved nonempty formats, including copies of old defaults, are never rewritten or augmented outside the template. Add `(  $codex_quota)` to either Opencode variant's `metadataFormat`, `($sep$codex_quota)` to a Footer wide `format`, or `$wrap_sep($codex_quota)` to `compactFormat`. Tokens remain empty when the corresponding quota toggle is off or the provider is ineligible. Unlike ordinary Footer `segments` flags, quota consent cannot be bypassed by a template.

**Compatibility and privacy:** Zentui uses Pi's public active-model metadata, `modelRegistry.getProvider("openai-codex")`, and `getProviderAuth("openai-codex")`, available on supported Pi 0.85.0, 0.87.1, and 1.0.3. Hosts without safe model/provider routing metadata do not collect or display quota; unavailable auth shows placeholders. There is no fallback to private storage or older credential APIs; the Pi minimum is 0.85.0. Auth is sent only to `https://chatgpt.com/backend-api/wham/usage`, with redirects rejected. JWT decoding is limited to the account-routing claim and is not identity verification. An opaque credential change invalidates cached data conservatively.

The endpoint is undocumented and may change or reject some plans. Its path and seconds-based window field are corroborated by [OpenAI's Codex client](https://github.com/openai/codex/blob/rust-v0.98.0/codex-rs/backend-client/src/client.rs); this is not a public API guarantee. Automated verification uses synthetic responses, not a live account. No reset times, countdowns, alerts, or quota history are provided.

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
| `editor` | `cwd`, `sessionName`, `gitStatus`, `contextNormal`, `contextWarning`, `contextError`, `cost`, `sessionDuration` | Same-named shared key; used by Minimalist metadata and quota |
| `editor` | `cacheHit` | Optional shared `cacheHit`, then Editor `contextNormal`; used only by Minimalist cache-hit metadata |
| `editor` | `gitBranch` | `editorGitBranch`, then explicitly configured shared `gitBranch` / `git`; never the generated Footer branch default |
| `editor` | `accent`, `border`, `prompt`, `rail`, `shellRail`, `model`, `provider`, `thinking`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh`, `thinkingMax` | `editorAccent`, `editorBorder`, `editorPrompt`, `editorRail`, `editorShellRail`, `editorModel`, `editorProvider`, `editorThinking`, and matching `editorThinking*` level keys |
| `userMessages` | `accent`, `border` | `editorAccent`, `editorBorder` |
| `selectorBorders` | `border` | No shared raw key: defaults to theme `borderMuted` / terminal `bright-black`; never inherits `editorBorder` |
| `workingLine` | `low`, `mid`, `high` | `workingLineLow`, `workingLineMid`, `workingLineHigh` |
| `editor`, `footer` | `prNumber`, `prUrl`, `ci`, `tokenRate` | No shared raw keys; existing neutral border/extension-status fallback |
| `workingLine` | `tokenRate` | No shared raw key; Static-only override, otherwise inherits mid; Classic/KITT use whole-row tiers |

Shared aliases `cwdText → cwd` and `git → gitBranch` remain accepted. Footer model/provider are plain text and the detected runtime label uses its runtime module's style, not invented Footer color keys.

Role-specific defaults and chains remain intact:

- Copy-friendly Opencode prompt uses explicit prompt → configured accent → the existing theme `accent` / terminal `blue` fallback. Model's constant fallback does **not** inherit a configured accent. Minimalist retains its distinct model/thinking defaults.
- In shell-command mode (`!` or `!!`), Opencode's left rail and model label share `shellRail` → configured `accent` → theme `bashMode` / terminal `bright-cyan`. Normal model coloring is unchanged.
- Accent Rail uses only `rail` / `editorRail`, then warm theme `syntaxNumber` / terminal `215`; it does not inherit `accent`.
- Minimalist branch defaults to theme `bold syntaxKeyword` / terminal `bold blue` when no local or explicit shared branch style exists.
- Minimalist's built-in `Cache NN%` label and `$cache_hit` use Editor `cacheHit` → optional shared `colors.cacheHit` → Editor `contextNormal` (local, then shared/default). The normal tier stays stable even at warning/error context usage. Configure it through `/zentui` → Editor → **Color overrides** → `cacheHit`; **Reset / inherit** resumes the chain. The selected Editor color source applies throughout; no cache-hit palette is generated or saved, and other owners are unchanged.
- Thinking levels use their level key then generic `thinking`; Max uses `thinkingMax → thinkingXhigh → thinking`. Static metadata and adaptive borders retain their existing distinct fallback behavior; theme-adaptive borders still defer to Pi's thinking-border callback.
- Working-line defaults remain theme `dim`, `muted`, `bold accent`, or terminal `bright-black`, `cyan`, `bold cyan`. Both animated rows and summaries consume local overrides. New persisted Turn summaries snapshot the effective high style; when no safe SGR prefix exists (including an unstyled high override), they retain the safe bold-cyan substitute. Existing persisted summaries keep their recorded style; legacy version-1 summaries use current high styling.

## Editor styles

### Accent Rail

Set `components.editor.style` to `accent-rail` or select **Accent Rail** in `/zentui`. Each input row uses its style-owned `rail` glyph (`▎`, or `asciiRail` in ASCII mode), one blank cell before text, and Pi's neutral filled surface. By default it has no prompt glyph, metadata, enclosing border, or blank chrome row. Opt-in eligible Codex quota is the sole metadata exception, adding a separate row beneath input when it fits. Viewport counts appear only while content is clipped.

Known autocomplete rows retain Pi's native text, descriptions, and scrolling on the same full-width surface. The selected native `→` becomes the configured rail without replacing Pi's selected-text color. Ambiguous third-party editor layouts fail open using already-rendered native rows.

`transparent` defaults to `false`. In `/zentui editor`, select **Editor style → Accent Rail**, then **Editor background → transparent** directly below it. Choose **filled** to restore Zentui's background. The control changes only `components.editor.styles.accent-rail.transparent`, removing Zentui-owned input and autocomplete backgrounds while preserving geometry, rail/text colors, and native selection backgrounds. It is also available as a saved preference while Editor is disabled. The rail and gap are rendered decoration, not underlying prompt text; terminal drag or rectangular selection can still include them.

### Minimalist

Set `components.editor.style` to `minimalist` or select it in `/zentui`. By default, the rounded frame places viewport counts and Bash state at top left; cost, model, thinking, and percent/total context at top right; viewport count plus session name and Git branch at bottom left; and compact path at bottom right. Top-left session name and turn timer are off by default. Unnamed sessions add no placeholder.

Path examples are `src` (`compact`), `zentui/src` (`project`), and `~/Projects/zentui/src` (`full`). Context can render as `11%`, `11%/372k`, or, with the gauge enabled and enough room, `[█░░░░] 11%/372k`. Enable `showCacheHit` to append values such as `Cache 98.2%`; it defaults to `false`, omits missing data, yields before context at narrow widths, and remains independent of Footer. The gauge shortens or disappears before the context text at narrow widths. Generated metadata obeys the session name, timer, cost, cache hit rate, and Git toggles; template references remain explicit (set `formats.bottomLeft` to `""` to hide its default session/branch label); model, thinking, and context remain structurally stable. Metadata items are joined with dashes by default (`separator: "dash"`) or dots (`separator: "dot"`).

Autocomplete stays inside the frame when Pi output can be split safely. Unknown third-party layouts fail open. Footer visibility remains independently controlled by `components.footer.style`; Minimalist does not remove Pi's header.

### Minimalist metadata templates and custom values

Minimalist has six independently configurable border slots under
`components.editor.styles.minimalist.formats`: `topLeft`, `topMiddle`,
`topRight`, `bottomLeft`, `bottomMiddle`, and `bottomRight`. Missing `bottomLeft`
inherits `"$session_name$join_sep($git_branch)"`; other missing slots keep
Zentui's generated layout; an empty string hides that slot's configurable
metadata. No extra rows are added. Use **Editor → Metadata templates** in
`/zentui` to edit a slot or **Reset / inherit** to delete its override.

Templates use `$variable`, `${variable}`, literal text, conditional `( ... )`
groups, and the additive `$join_sep` marker. Layout is selected by the six slot names, not
`$fill`. Viewport counts, Bash mode, and an embedded Working line remain
operational indicators outside the templates. Explicit templates may show
metadata whose ordinary visibility toggle is off, but can never bypass Editor
Codex quota consent. Nothing is appended outside an explicit template.

Custom values are published by other extensions. Give them simple local names
with `variables`, then reference those names in any slot:

```json
{
  "components": {
    "editor": {
      "style": "minimalist",
      "styles": {
        "minimalist": {
          "variables": { "claude_quota": "@scope/usage:quota" },
          "formats": {
            "topMiddle": "$claude_quota",
            "bottomMiddle": "$session_name"
          },
          "extensionColorMode": "original"
        }
      }
    }
  }
}
```

**Editor → Custom variable aliases** edits the name-to-publisher-key JSON or
resets the aliases. Names use letters, digits, and underscores, start with a
letter or underscore, and cannot replace built-in/structural variables or
prototype names, except that a valid explicit `ci` alias retains precedence over the new GitHub builtin. At most 16 aliases are accepted; keys are nonempty, at most
64 UTF-16 code units, and contain no whitespace or terminal controls. Reset
removes only the edited overrides. Unrelated owners/styles and unknown raw
configuration remain untouched. These settings never enable Footer or Working
line.

Built-ins are `$model`, `$model_id`, `$model_name`, `$provider`, `$thinking`,
`$fast_mode`, `$session_name`, `$turn_duration`, `$cost`, `$context`, `$cache_hit`,
`$codex_quota`, `$cwd`, `$git_branch`, `$git_status`, `$tokens`, `$input_tokens`,
and `$output_tokens`. `$turn_duration` is current/completed interaction time,
not total session duration. Existing path, context, separator and color
preferences still apply. `$sep` (alias `$separator`) uses the configured
Minimalist dash/dot separator. `$join_sep` (or `${join_sep}`) joins only populated
fields with that same styled separator. For example, set `bottomLeft` to
`"$session_name$join_sep($git_branch $git_status)"` for a session-only, Git-only,
combined, or empty label; explicit references work even with `showSessionName`
off. Do not add padding around the marker. Legacy `$sep` and optional-group
formatting remain unchanged; see [conditional joining](./footer-format.md#conditional-joining)
for chains, nested scopes, preserved ANSI/link styling, and boundaries.

Pi and OMP support `$pr_number`, `$pr_url`, `$ci`, and `$token_rate` (see [live metadata](#live-metadata)). OMP additionally supports the [host template data](#omp-template-data) built-ins
in all six slots and both Opencode metadata formats. These are separate from
publisher aliases and are not included in `$extensions`.

`$extensions` aggregates published custom values in deterministic key order.
The generated top-right layout includes it after cost; setting an explicit
slot lets you move or omit it. Values referenced through an alias anywhere in
the six effective templates are excluded from the aggregate, avoiding an
automatic duplicate. This is distinct from Footer's existing extension-status
integration. Custom values do not automatically consume `ctx.ui.setStatus()`.

Centers are terminal-centered and clamped between side labels; they disappear
whole when they cannot fit. Custom values yield whole before built-in side
metadata at narrow widths, rather than clipping quotas or activity labels.
Large aggregates yield as one unit. Literal separators are template-owned;
use conditional groups around optional values. Width cannot guarantee that
all configured metadata is visible.

**Custom value colors** offers Original (default) and Zentui. Original retains
safe SGR and HTTP(S) links from the publisher, with closing resets so styles
cannot leak into borders. Zentui strips publisher styling and applies the
Editor color source and extension-status fallback style. Newlines and other
terminal controls are sanitized; no publisher callbacks or commands run while
rendering.

#### Custom-value publisher protocol v1

The versioned event-bus protocol publishes data, not a location. Probe before
each refresh and keep the extension's normal fallback when inactive:

```typescript
const key = "@scope/usage:quota";
const capability = { supported: false, active: false, key };
pi.events.emit("zentui:variable-capability", capability);

if (capability.active) {
  pi.events.emit("zentui:variable", { key, text: "CC $459/1200" });
  ctx.ui.setStatus(key, undefined); // remove this publisher's own fallback
} else {
  ctx.ui.setStatus(key, "CC $459/1200");
}

// Remove a value on publisher shutdown or when no longer applicable.
pi.events.emit("zentui:variable", { key, text: undefined });
```

Zentui adds `version: 1` and `supported: true` to a mutable probe. Optional
`key` tests demand for that particular publication; without it, `active`
reports whether any custom value is demanded. Active requires the current TUI
session and either an owned, enabled, safely decorated Minimalist/Opencode
editor with a referencing alias or aggregate, or an owned Starship Footer with
a referencing alias in its wide or responsive compact template. Availability
is the union of independently owned consumers: disabling Editor never drops a
value still demanded by Footer. It is not a guarantee of visibility at the
current width. Startup probes may precede the first safe
editor render: probe again on the publisher's next refresh. This protocol
adds no Zentui poller and no capability-change notification.

Use stable package-qualified keys. The namespace is global by convention;
collisions are last-update-wins, and either publisher can remove a shared key.
At most 16 unique values are retained, with keys up to 64 and raw text up to
256 UTF-16 code units. Malformed/over-limit updates are ignored; existing
keys can still update at capacity. Empty text also removes. Positive updates
while inactive are ignored. Session replacement, shutdown, disable, loss of
ownership, or loss of template demand drops inactive values; publishers must
republish after reactivation. Publishers own their refresh resources, data
freshness, and stale markers. Zentui neither fetches account data nor persists
these values. Working-line protocol v1 remains unchanged.

### Opencode completion menu

Both Opencode variants default to `completionMenu: "palette"` and can be configured independently. The transparent palette keeps captured native rows and embedded backgrounds, removes only a recognized selected `→` while preserving native emphasis, omits a narrowly recognized trailing count row such as `(1/47)`, fills available width without adding a background, and adds a bottom separator plus `↑↓ Navigate   Enter Use   Esc Close`.

It intentionally has no results header, range, category column, selected background, or side borders because Pi does not expose that structured data through a stable public API. Set a variant to `"native"` to preserve Pi's trailing rows byte-for-byte. Copy-friendly users who prioritize rectangular selection may prefer Native.

If autocomplete capture or frame provenance is ambiguous, Zentui returns the same native rows without rendering the editor again. Accent Rail and framed styles may therefore retain their reduced probe width on this rare fail-open path. Selected prefixes and trailing counts are rewritten only when they match narrow native patterns; unrecognized forms remain visible.

Tip: with `opencode-copy-friendly`, set Pi's `editorPaddingX` to `1` for a small left gutter without copying a rail.

### Editor metadata format

Each Opencode variant owns an independent `metadataFormat`:

Both support `$join_sep` / `${join_sep}` to join populated fields with neutral
border-styled ` · `, for example `$model$join_sep$provider$join_sep$thinking`.
Missing middle fields leave exactly one separator; single fields have none.
Do not pad the marker: it owns its spaces. Joins are local to groups and never
cross `$fill` zones. Legacy `$sep` / `$separator` still render empty in Opencode.
See [shared conditional-joining semantics](./footer-format.md#conditional-joining).
The marker is reserved (not a custom alias or data demand), requires a supporting
version, and does not rewrite defaults, saved templates, or other components.

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
| `$fast_mode` | OMP's supported `fast` or `ultrafast` selection; empty when off, unsupported, or running Pi |
| `$session_name` | current Pi session name; empty when unnamed |
| `$context` | compact current context usage and window, for example `26.8%/272k` |
| `$tokens` | cumulative session input/output tokens only, for example `↑76k ↓1.6k` |
| `$cache_hit` | latest assistant prompt cache-hit rate to one decimal; `0.0%` when unavailable |
| `$codex_quota` | remaining 5-hour/weekly account quota; requires Editor quota consent and active `openai-codex` |
| `$join_sep` | conditional join with neutral border-styled ` · ` |

`$context` uses Pi's current context snapshot and the live assistant context override, refreshing on the existing 250 ms streaming render cadence. `$tokens` and `$cache_hit` use authoritative persisted session snapshots, so they update at normal session synchronization boundaries rather than estimating in-progress totals. These variables are independent of Footer visibility, style, color source, and configuration.

### Custom values in Opencode metadata

Both Opencode styles can reference the same event-bus values used by Minimalist.
Each style has independent `variables` and `extensionColorMode` settings:

```json
{
  "components": {
    "editor": {
      "styles": {
        "opencode": {
          "variables": { "quota": "@scope/usage:quota" },
          "metadataFormat": "$model( · $quota)$fill($session_name)",
          "extensionColorMode": "original"
        },
        "opencode-copy-friendly": {
          "variables": { "quota": "@scope/usage:quota" },
          "metadataFormat": "$model$fill($quota)"
        }
      }
    }
  }
}
```

Aliases and these formats are JSON-only for Opencode; Minimalist's settings
controls still edit only Minimalist. Missing color mode means Original; Zentui
uses Editor's color source and the historical extension-status fallback style.
Custom values yield whole before built-in metadata when the row cannot fit.
No value is automatically appended to an explicit format. Enabling/disabling
Editor or changing a format never changes Footer choices.

Starship independently supports aliases under
`components.footer.styles.starship.variables` and Original/Zentui under
`extensionColorMode`; both wide `format` and responsive `compactFormat` can
reference them. See [custom Footer values](./footer-format.md#custom-extension-values).
Native/Hidden Footer and existing `setStatus` placement/color choices are
unchanged. Footer's compact `$extensions` continues to mean Pi's keyed extension
statuses, not this new variable registry. Removing an alias/format reference
releases only that consumer's demand; values survive while any other owned
consumer still references them.

Model variables use Editor `colors.model` (legacy `editorModel`), provider uses `colors.provider` (legacy `editorProvider`), and thinking uses the matching Editor level style. Literal text, session name, and usage metadata use the neutral editor-border theme style. ANSI/VT sequences, controls, and line-breaking whitespace are sanitized without collapsing ordinary spaces.

Missing, non-string, or empty values use `$model  $provider(  $thinking)(  $fast_mode)(  $codex_quota)`, with identical Pi spacing while the optional values are empty. OMP's current per-family service tier is checked against the active model's capabilities each render, so `/fast` and model changes do not leave stale indicators. Saved nonempty templates are not rewritten; add `( · $fast_mode)` explicitly to opt in. A non-empty format that resolves to no metadata preserves the normal blank spacer and metadata rows. This option is JSON-only; `/zentui format` controls the Footer.

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

Each selected SGR-free label is rendered as Markdown by a fresh Pi `Markdown` with the host child's exact theme, default `thinkingText`/italic style, and transform options. Native emphasis, code, links, HTML, LaTeX, and custom theme/transform callbacks therefore remain authoritative. Host horizontal padding is applied externally. Each label is exactly one terminal row; Pi TUI's ANSI/OSC/grapheme-aware width utilities crop the first rendered row and reserve one cell for `…` only when required. Empty, image, non-text, impossible-width, or throwing output restores the whole native run. Connectors are separate from Markdown and call the current `theme.fg("accent", connector)` when building a layout, so custom themes directly control their appearance. Successful layouts are reused while width and connector-theme identity are unchanged; a width or theme identity change or invalidation refreshes them. Same-object theme mutations require invalidation. Visible forms are:

```text
│ Thinking       ┆ Thinking
│ First          ├─ · Earlier
│ Latest         └─ · Latest
│ • Open         └─ • Open
```

Only an actually open thinking phase uses `•`; a text/tool transition or restored completion is settled. Rail and Tree preserve Pi's hidden state and native hidden label. The `/zentui` Mode action offers all three modes, but entering Streaming from Rail or Tree is saved for restart rather than applied live.

Streaming keeps the reviewed host-rendered behavior: while open it shows the latest five rendered terminal rows beneath `Thinking 7.1s`; completion folds under `Thought` or current-session `Thought for Ns`. Restored entries have no duration because Pi does not persist a reliable thinking-end timestamp. Only a session started in active Streaming owns its validated configured `app.thinking.toggle` binding and one-second timer. Ctrl+T expands/refolds native reasoning. Startup resource failures and private-shape/render failures use complete native thinking. A cleanup callback that throws while leaving Streaming is contained: Rail or Tree remains active, while Streaming becomes unavailable for that session. Component and timing tracking are bounded to 256; evicted entries are restored natively first.

The exact all-mode private matrix covers Pi 0.85.0, 0.87.1, and 1.0.3 under dark, light, and current themes, narrow/wide widths and resize; all three versions also have fullscreen live-transition PTY coverage. Thinking (Experimental) never owns or writes the Working line, including its unchanged **Thinking time** option, and does not own Footer, Editor, widgets, statuses, or model behavior.

## Individual custom value colors

Sparse `components.editor.customValueColors` and `components.footer.customValueColors`
are keyed by **publisher ID**, not template alias. All aliases for that publisher
and Minimalist's supported `$extensions` aggregate share the override within the
owner, across its styles. Footer's `$extensions` remains the existing status
protocol and is not affected. Working-line publisher segments are a separate
protocol and do not consume these maps.

```json
{
  "components": {
    "editor": { "customValueColors": { "vendor.package/value": "bold fg:202" } },
    "footer": { "customValueColors": { "vendor.package/value": "" } }
  }
}
```

Missing overrides retain the style's Original/Zentui behavior exactly. Explicit
styles strip publisher SGR and hyperlinks before styling through the selected
owner color source; empty/whitespace deliberately means unstyled. Reset deletes
one leaf and restores inheritance. Theme tokens, hex/256-color values and
Starship-style modifiers are supported. Normalization accepts up to 1024 own
properties and styles up to 4096 UTF-16 units; invalid keys/styles inherit.
Saves preserve unrelated raw JSON, invalid/future leaves and the other owner;
ordinary selection saves and `/zentui migrate` never snapshot these maps or
rewrite templates.

## Live metadata

Minimalist's six slots, both Opencode metadata formats, and Starship wide and
responsive compact templates support these explicit opt-in references:

| Variable | Pi | OMP |
| --- | --- | --- |
| `$pr_number`, `$pr_url` | Open PR number and safe plain HTTPS URL for a non-default branch | Same shared collector |
| `$ci` | `CI passing`, `CI running`, `CI failed`, `CI no checks`, or `CI stale` | Same shared collector |
| `$token_rate` | Completed model-work average for the current interaction, e.g. `48 tok/s avg`; unknown is `— tok/s avg` | Existing native last-assistant / streaming worker rate unchanged |

No default or saved template is rewritten. For example:

```json
{
  "components": {
    "editor": {
      "colors": { "ci": "bold blue", "tokenRate": "fg:202" },
      "styles": { "opencode": { "metadataFormat": "$model( · PR #$pr_number)( · $ci)( · $token_rate)" } }
    },
    "footer": {
      "styles": { "starship": {
        "format": "$cwd( · PR #$pr_number)( · $ci)$fill$context",
        "compactFormat": "$cwd$wrap(PR #$pr_number)$wrap($ci)$wrap($token_rate)"
      } }
    }
  }
}
```

A valid owner/style-local `variables.ci` mapping **wins over the builtin** and
creates only publisher demand. Remove that mapping to opt into GitHub CI. Other
builtin reservations are unchanged. Builtin colors use independent owner-local
`prNumber`, `prUrl`, `ci`, and `tokenRate` roles, not publisher color maps; CI has
one role, not an automatic severity palette.

GitHub collection is read-only via `gh`, asynchronous and outside render. It
runs immediately, then refreshes at the completed result's 30-second cache
expiry, only while an owned, enabled, supported consumer references PR/CI.
Expiry repaints CI as stale before awaiting the next fetch; failures without a
cache deadline retry after 30 seconds. Editor and Footer share one neutral snapshot but keep
independent settings/appearance. Each refresh verifies repository, branch,
remotes and local HEAD identity, including cache hits; observed project/tool and
host branch changes invalidate immediately. External changes are discovered on
the next demanded refresh, not instantaneously. Valid repo metadata lasts five
minutes; PR successes and negative results last 30 seconds. Identity/context
changes, demand loss and shutdown abort outstanding work. No auth commands,
credential reads, forge mutations or other forges are supported.

CI is qualified by the PR head: a local commit different from the remote PR head
is **stale**, never green. Dirty files alone do not change commit identity.
Expired CI is stale while refreshing; errors clear earlier results. Zero checks
or only skipped/neutral checks are **no checks**, not passing. Unknown/malformed
checks are never proof of success. No PR, closed/default/detached branches,
missing `gh`/read access or lookup errors are empty; optional groups hide labels.

Pi Editor/Footer `$token_rate` is a **completed model-work average**: sum of
provider-reported final output tokens divided by the sum of observed model-call
durations in the current interaction. Each interval starts when Zentui observes
public `turn_start` and ends at its matching accepted assistant `message_end`,
using a monotonic clock. This includes initial wait **and client preparation
before the provider call**; it is not pure backend decode speed. Tool execution,
between-call gaps and idle are excluded. For example, 120 output tokens over 4s
(including 2s initial wait), then 180 over 2s after a 10s tool gap, gives
`300 / 6 = 50 tok/s avg`, not an average of call rates or `300 / 16`.

The slot shows `— tok/s avg` before a trustworthy completed sample, never a
live-rate substitute. After each completed call it shows **completed calls so
far**, retaining the previous aggregate while another call in the same interaction
is in flight, through tools, `agent_end` and settlement. Continuation/retry
`agent_start` does not reset it; a genuinely new interaction does. If non-idle
settlement partitions an already-started run into a new interaction, only that
surviving run's completed work and any open call's original start are retained;
unknown coverage from settled runs is discarded, but surviving unknown coverage
remains unknown. Only accepted,
deduplicated finals contribute per-message output, never cumulative interaction
totals, last streaming usage or character estimates. Successful reported zero
output is included with its duration. Positive provider-reported partial/error
usage is included with a matching interval; all-zero error/abort placeholders
are unknown. Missing/invalid final usage or timing for any included call makes
the aggregate unknown until reset rather than silently showing a partial exact
average. This reflects final usage visible to Zentui's event handler, not a
history scan or independent verification of provider accounting.

Working line keeps its separate **recent live rate**, with `~` for estimates
and `— tok/s` before a usable measurement. It uses a bounded three-second
observation window and needs advancing output spanning at least 500ms, excluding
pre-output silence. The measurement expires after two seconds without advancing
output, but its display holds the last observed window rate while the Working row
remains active: between chunks, through response end, tools, between-call pauses,
continuations/retries and subsequent model turns in the same interaction. A fresh
usable live sample replaces it; a retained value is historical, not ongoing generation.
Text, thinking and tool-call argument deltas use the existing Unicode estimator;
source/usage corrections rebaseline rather than producing spikes. Final usage
never creates an instantaneous live sample. Working rate is independently opt-in;
a genuinely new interaction starts at `— tok/s` until its first usable measurement.
If non-idle settlement promotes an already-started run into a new interaction,
only that surviving run's observation is retained; an older run's value becomes
`— tok/s`. The whole Working row still disappears normally at idle/settlement.

Compaction, session/model/tree changes and loss of all rate demand clear both
metrics. After a mid-run model change, the next properly observed turn can
establish a new current-model aggregate without another `agent_start`. Repaint
polling is active only while streaming and demanded; retained rates and averages
need no idle timer. These live metrics add no latency measurement; persisted summaries have their own snapshot schema.
OMP's native `$token_rate` semantics are unchanged.

## Working line

When enabled, Zentui owns Pi's complete working-row message and indicator. Five fixed-width spinner presets are available: Braille Orbit, Star Bloom, ASCII Pinwheel, Claude-inspired, and three-cell Pulse.

`messages.custom` defaults on and selects once per model turn from an editable, materialized 16-message list. Turning it off keeps the row owned and displays animated `Working…`; an empty or invalid list uses the same fallback. Optional segments show the latest active Tool, interaction-wide Elapsed time, cumulative wall-clock Thinking time, and whole-interaction Tokens. **Token rate** defaults on (`segments.tokenRate: true`) when Working line is enabled; Working line defaults on with Border placement. Minimalist’s own timer defaults off; Working-line Elapsed stays on. Explicit saved choices remain unchanged. Set `segments.tokenRate: false` to hide the rate. Enable Working line without adopting Editor or Footer: `{"components":{"workingLine":{"enabled":true,"colors":{"tokenRate":"fg:202"}}}}`. It holds the last observed recent live Pi rate through tools and subsequent calls in the same interaction, not the completed average in Editor/Footer `$token_rate`. The row disappears normally at idle, and identity changes such as compaction clear the observation; see [live metadata](#live-metadata).

Committed totals stay provider-reported across tool loops, retries, compaction retries, and queued continuations. During a response, live output follows Pi's `↓N` convention whether usage is provider-reported or temporarily estimated. Final usage reconciles atomically; input is never estimated. Labels are sanitized and width-bounded.

When Pi settles, the default-on boolean **Turn summary** (`turnSummary`) appends a persistent context-free row such as `Turn took 56s · thought for 10s · ↑7.1k ↓779 · 42 tok/s avg`. Thought is cumulative wall-clock time from Pi's public thinking stream; overlaps count once and zero is omitted. Output already includes reasoning tokens, so reasoning is not added separately. The default template includes both token totals even when live Tokens or **Thinking time** is hidden or zero. Summaries are inactive while Working line is disabled.

`turnSummaryFormat` is a terminal-safe single-line template (maximum 2048 code units and eight nested optional groups). Missing, invalid, empty or whitespace-only values use the default shown above; use `turnSummary: false` to hide new summaries. Supported variables are `$turn_duration`, `$thought_duration`, `$input_tokens`, `$output_tokens`, and `$token_rate`. Braced variables and optional `(groups)` use the existing format grammar; unknown names are empty. `$sep`/`$separator` emit ` · `; `$join_sep` joins only nonempty fields. Zero thought is empty; known-zero counts remain `0`.

Summary `$token_rate` is a complete label such as `42 tok/s avg`, or empty when exact final usage/timing coverage is unavailable (never an unknown dash). It sums provider-reported final assistant output divided by summed observed `turn_start` → accepted `message_end` durations, including initial wait/client preparation and excluding tools/gaps, across the **whole settled interaction**, including model selections and continuations. Non-idle settlement includes only settled runs, not an already-running successor. Summary-only collection is passive: it does not enable live Token rate, Editor/Footer slots or sampling timers. Enabling collection late cannot claim a partial exact average.

`components.workingLine.colors.turnSummary` styles only new static transcript summaries. Missing/invalid values inherit effective Working **high** (local then shared fallback); explicit empty/whitespace means unstyled. `/zentui` → Working line offers **Turn summary format** Edit/Reset and **Color overrides** → `turnSummary`; Reset deletes only that override. Format and resolved style are snapshotted in new entries, so changes never rewrite history. Legacy v1/v2/v3 entries retain their original output without fabricated historical TPS. OMP remains native.

Classic and KITT sweep across the entire row: Message, Tool, Elapsed, Thought, Tokens, Token rate (including `— tok/s`), and extension segments. A saved `colors.tokenRate` override never creates a fixed-color segment in animated modes; it applies only in Static (`textAnimation: "disabled"`). **Animate spinner color** optionally includes spinner cells and separator. Static uses the mid tier except for an explicit Token rate override; an omitted or invalid override inherits mid, while an empty style deliberately leaves Token rate unstyled. Static ignores text speed/spinner-color participation without changing saved values. Spinner glyph motion always remains active.

| Setting | Default | Presets | Applies to |
| --- | ---: | --- | --- |
| `spinnerIntervalMs` | 100 ms | Fast 60 / Normal 100 / Slow 160 / Custom | glyph motion |
| `textIntervalMs` | 60 ms | Fast 40 / Normal 60 / Slow 100 / Custom | Classic/KITT color motion |

Both speeds accept `30..1000` ms. Classic/KITT combine both cadences through one Pi Loader interval; exact cycles are used within 1024-frame/512-KiB limits. Pathological custom pairs use a bounded evenly distributed schedule with at most half a spinner-cycle and half a text-step rounding. Legacy `intervalMs` is accepted only as migration input for `spinnerIntervalMs` when the canonical field is absent.

Content reserves the complete Tokens and optional Token rate labels and active extension segments first, then Message, Thought, Elapsed, and Tool allocation, while preserving visual order **Message · Tool · Elapsed · Thought · Tokens · Token rate · Extensions** within the 80-column Loader-row contract. Active thought starts as `thinking 0s`; completed positive thought becomes `thought for Ns`. Rebuilds preserve spinner and visible color phase.

Pi's working-row APIs are global and unkeyed. While owning the row, Zentui reasserts its blank message on owned refreshes/reconciles (even with unchanged frames) and before a Border fallback reveals the Above row. A later external message write or reset can still win until the next such boundary; native spinner ticks alone do not repair it, and there is no added polling. Separate multiline widgets are unaffected; extensions sharing the working-message slot should use keyed segments below instead.

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

## Icon Auto detection

`icons.mode: "auto"` preserves Auto in memory and on disk while deriving an effective mode for the current process. Exact `ZENTUI_NERD_FONTS=1` or `0` overrides Auto. Otherwise Auto selects Nerd glyphs when `TERM_PROGRAM` is `iTerm.app`, `WezTerm`, or `ghostty` (case-insensitive), or when `KITTY_WINDOW_ID` or `ALACRITTY_SOCKET` is nonempty. Unknown terminals, VS Code, and Windows Terminal default to ASCII-safe glyphs. Explicit `nerd` and `ascii` modes ignore the override and environment signals.

This is conservative terminal-environment detection, not font probing: terminal identity cannot prove that a Nerd Font is installed or configured. Use explicit mode or `ZENTUI_NERD_FONTS` when Auto chooses incorrectly. Custom icon overrides still win over either effective mode.

## Runtime detection

Runtime/language modules use Starship Nerd Font symbols and defaults such as `bold green` for Node.js. Theme mode maps those styles through Pi; Footer terminal mode uses the terminal colorscheme's ANSI colors. In Auto mode, runtime, OS, package, rail, and gauge symbols all use the same derived effective icon mode.

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

Save this in Pi's `~/.pi/agent/settings.json`, select fullscreen in Pi's `/settings`, or use `--tui-mode fullscreen`. Zentui does not enable it automatically. Pi owns layout and scrolling while Zentui supplies configured components. Zentui requires Pi 0.85.0 or newer.

## Oh My Pi compatibility

OMP 18.4.10+ uses `omp.ts` as a deliberately focused skin for **Editor, User messages, and Statusline only**. `/zentui` defaults to Editor and cycles through those three sections; `/zentui statusline` opens the canonical Footer owner. Footer-local Segments/Git controls and three-owner presets remain available. Working, thinking, selectors, turn summaries, and all-owner migration remain OMP-owned; their saved values are ignored by the focused runtime without being rewritten. Pi's full component set is unchanged.

`npm run omp:dev` launches with only this extension; `npm run omp:install-local` links the checkout with `omp plugin link`. OMP remaps shared Pi package imports to its own host modules, avoiding duplicate runtime classes/theme state.

| Surface | OMP behavior |
| --- | --- |
| Editor | All Zentui styles support OMP's built-in Box, Band, Claude, Pi, Borderless, Rule, Field, and Rail layouts, preserving multiline input, cursor markers, shell submission, and autocomplete. Public composer row capture leaves native input layout/preferences unchanged. Unknown/ambiguous chrome fails open; decorated mouse geometry is not guessed. |
| Fast mode | `$fast_mode` is `fast` for supported priority service and `ultrafast` for supported OpenAI ultrafast service. Other families' preferences, off/default/flex tiers, and unsupported models render empty. This reports the selected supported tier, not a latency guarantee. |
| User messages | Normal Markdown messages support Zentui styles. Native image, badge, synthetic, and unfamiliar message surfaces remain native. |
| Statusline | Starship replaces the native lower status slot and suppresses native attached status content; there is no persistent footer widget or duplicate main line. Hidden suppresses main status content and retains only permitted extension statuses; Native delegates exact native behavior. Editor enablement is independent. |

OMP's `setFooter()` is inert, so the adapter decorates exported native status renderers and restores only its own methods. Scope is established by matching session identity and mounted public `editor.composerFacts` identity. Verified ownership survives temporary dialog unmounting, but editor replacement, detached containers, session changes, and foreign method displacement release it; native startup/preview and other sessions remain untouched. The guarded runtime `session` field is the private compatibility boundary—changed/uninspectable shapes fail open to native. Native preferences/status maps are not rewritten. Extension statuses are recorded from successful public publications starting at extension initialization, including earlier `session_start` handlers; publications predating observation cannot be recovered. In TSP terminals, custom status is plain semantic composer text rather than ANSI frame/color parity; host-owned model-picker action/icon chrome remains native.

OMP has no public editor-factory getter. Zentui observes public setter descriptors across handler scopes and preserves expanded drafts for its observed editors. Initial replacement is OMP's normal last-writer-wins behavior: an opaque pre-existing editor factory cannot be recovered or wrapped. Once a later setter is observed, cleanup restores only Zentui-owned state. Handler-local dialog cancellation remains scoped to the invoking command.

### OMP template data

The following explicit Zentui names are available in Opencode/copy-friendly
`metadataFormat`, all Minimalist slots, and Starship `format`/`compactFormat`.
OMP segment IDs are not automatically template variables. These names are
reserved built-ins, except the explicit `ci` alias compatibility rule; `$extensions` is unchanged.
Pi supplies the [shared PR/CI and live rate variables](#live-metadata); other host-only or unavailable capabilities render empty.

| Variable | Data and distinctions |
| --- | --- |
| `$session_id` | Current session's full ID, not its human-readable `$session_name`. |
| `$pr_number`, `$pr_url` | Current non-default branch's GitHub PR number and safe plain HTTPS URL. |
| `$ci` | Shared GitHub PR-head CI state; see [live metadata](#live-metadata). |
| `$subagent_count` | Native active subagent badge count; background Bash/Eval jobs are not subagents. A known zero renders `0`. |
| `$token_rate` | Output tokens/second, for example `42.5 tok/s`. Uses OMP's last-assistant average; observed live Vibe workers add the current streaming main rate, not an idle previous reply. Unknown timings remain empty. |
| `$active_time` | Native accumulated active-processing time, including the open interval and excluding idle time, for example `1m 5s`. Not wall-clock `$session_duration` or current/completed `$turn_duration`; a known zero renders `0s`. |
| `$hostname` | Machine hostname without the username. |
| `$usage_quota` | Proven current-provider/model/account quota windows, for example `5 Hour: 80% left`. Distinct from independently consented `$codex_quota`. |
| `$collaboration` | Native role and participant count, for example `host · 3 participants`; participants include the host. |
| `$stream_state` | Native publisher state and remote viewer count. `live · 0 viewers` is active; no publisher renders empty. |
| `$vim_mode` | Current native editor `insert`, `normal`, `visual`, or `visual-line` state. Disabled Vim renders empty. |
| `$plan_mode`, `$goal_mode` | `Plan`/`Goal`, or `Plan paused`/`Goal paused` when the native paused state is known. |
| `$prewalk_mode` | `Prewalk` while the attached session has a Prewalk target. |
| `$vibe_mode` | `Vibe` while enabled. |
| `$loop_mode` | `Loop waiting`, `Loop running`, or `Loop paused`; no loop renders empty. |

Defaults and saved templates are never augmented. Add only the desired variables,
with optional groups around labels:

```json
{
  "components": {
    "editor": {
      "styles": {
        "opencode": {
          "metadataFormat": "$model( · $session_id)( · PR #$pr_number)( · $subagent_count agents)( · $active_time)( · $token_rate)( · $vim_mode)"
        }
      }
    },
    "footer": {
      "styles": {
        "starship": {
          "format": "$cwd( · PR #$pr_number)( · $plan_mode)( · $goal_mode)( · $loop_mode)$fill$context",
          "compactFormat": "$cwd$wrap(PR #$pr_number)$wrap($active_time)$wrap($token_rate)"
        }
      }
    }
  }
}
```

PR/CI data uses the [shared demand-controlled collector](#live-metadata), requiring a matching GitHub remote, `gh`, and read access. It captures and rechecks full repository/branch/remote/HEAD identity, caches PR results for 30 seconds and successful repo metadata for five minutes, and invalidates on observed project/branch changes. No PR, default/detached branches,
unavailable tooling, or lookup failure renders empty rather than a placeholder.

**`$usage_quota` is opt-in by explicit template reference.** It uses the current
native session's public usage-report API and declared public account-routing
capability, never credentials/keys or private native quota caches. OMP may refresh
authenticated reports from its configured providers on a cache miss. Successful
snapshots are cached for up to five minutes, shortened by window resets; there
is no additional polling timer or default request. Missing identity, ambiguous
accounts, mismatched provider/model scopes, failures, and expired windows omit
the affected data. A real zero remaining quota stays visible. The Editor and
Footer's `$codex_quota` toggles remain separate and are not changed.

Session ID/hostname use public context/OS data. Other fields require a verified
native component/session/editor association even when Footer is Native or Hidden.
Current public Vim/session getters take precedence where supported; native
Plan/Goal/Vibe pause flags, Loop, collaboration, stream state, and worker-rate
callbacks are observed only after successful public publications. Publications
predating observation cannot be recovered from private fields. Plan/Goal/Vibe
snapshots reset with session identity; native UI-global states stay local to
their component across focus changes. Locked or displaced setters disable
observation, and disposal restores only still-owned descriptors. All rendered
text follows the consuming component's sanitization and local colors.

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
