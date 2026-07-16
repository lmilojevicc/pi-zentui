# Zentui

A Starship-inspired statusline and Opencode-style TUI for [Pi](https://pi.dev).

## Screenshots

![Zentui](https://raw.githubusercontent.com/lmilojevicc/pi-zentui/main/assets/zentui.png)

## What is this?

Zentui brings two popular aesthetics to Pi:

- **[Starship](https://starship.rs/) footer** — shows your current directory, git branch, git status indicators, and runtime/version detection in a compact, icon-rich format
- **[Opencode](https://github.com/opencode-ai/opencode) editor** — clean bordered input box with accent rail, copy-friendly mode, and model/provider display inside the editor frame

## Features

### Footer (Starship-inspired)

- `dirname` — current directory (`basename` by default; optional `full` path with directory depth via `pathDisplay`)
- `on  branch` — git branch with icon
- `[!?↑]` — git status indicators (modified, untracked, ahead/behind, stashed, etc.)
- `via  v5.5.0` — runtime detection with version and Starship-style Nerd Font runtime/language modules
- Optional segments (off by default): `user@host`, current time, OS icon, session duration, and the **project package version** (e.g. `package.json` → `0.6.0`) — distinct from the runtime segment, which shows the installed toolchain
- Right side shows context usage, token counts, and cost
- Built-in footer segments can be shown or hidden individually from `/zentui`
- Fully custom Starship-style layout via a `footerFormat` template string — see [Footer Format Template](#footer-format-template)
- Third-party Pi extension statuses from `ctx.ui.setStatus()` can be shown on the left,
  middle, or right side, or hidden per status key from `/zentui`

### Editor (Opencode-inspired)

- Bordered input box with configurable accent rail and border colors
- Model name and provider displayed inside the editor frame
- Configurable model, provider, and thinking-level indicator colors
- Prompt-box-style user messages matching the ZentUI input chrome
- Copy-friendly mode hides editor and previous-message rail glyphs so terminal selection copies less chrome
- **Fixed editor** (experimental, opt-in): Pin the editor and footer at the bottom of the terminal while the transcript scrolls above

### Git Status Icons

| Icon | Meaning    |
| ---- | ---------- |
| `!`  | Modified   |
| `?`  | Untracked  |
| `+`  | Staged     |
| `✘`  | Deleted    |
| `»`  | Renamed    |
| `=`  | Conflicted |
| `$`  | Stashed    |
| `↑`  | Ahead      |
| `↓`  | Behind     |
| `⇕`  | Diverged   |

### Runtime Detection

Detects Starship Nerd Font runtime/language modules, uses the Starship Nerd Font symbols, and keeps Starship-style defaults such as `bold green` for Node.js. By default Zentui maps those styles through your active Pi theme; switch the Starship/footer color source to `terminal` in `/zentui` if you want your terminal colorscheme to supply the exact ANSI colors.

| Runtime/language | Detection examples                                            |
| ---------------- | ------------------------------------------------------------- |
| Buf              | `buf.yaml`, `buf.gen.yaml`, `buf.work.yaml`                   |
| Bun              | `bun.lock`, `bun.lockb`                                       |
| C                | `.c`, `.h` files                                              |
| C++              | `.cpp`, `.cc`, `.cxx`, `.hpp` files                           |
| CMake            | `CMakeLists.txt`, `CMakeCache.txt`                            |
| COBOL            | `.cbl`, `.cob` files                                          |
| Conda            | `CONDA_DEFAULT_ENV` environment                               |
| Crystal          | `.cr` files, `shard.yml`                                      |
| Dart             | `.dart` files, `pubspec.yaml`, `.dart_tool/`                  |
| Deno             | `deno.json`, `deno.jsonc`, `deno.lock`                        |
| .NET             | `.csproj`, `.fsproj`, `global.json`, `Directory.Build.*`      |
| Elixir           | `mix.exs`                                                     |
| Elm              | `.elm` files, `elm.json`, `elm-stuff/`                        |
| Erlang           | `rebar.config`, `erlang.mk`                                   |
| Fennel           | `.fnl` files                                                  |
| Fortran          | `.f`, `.f90`, `.f95`, `.f03`, `.f08`, `.f18`, `fpm.toml`      |
| Gleam            | `.gleam` files, `gleam.toml`                                  |
| Go               | `go.mod`                                                      |
| Gradle           | `build.gradle`, `build.gradle.kts`, `gradle/`                 |
| Guix shell       | `GUIX_ENVIRONMENT` environment                                |
| Haskell          | `.hs`, `.cabal`, `stack.yaml`, `cabal.project`                |
| Haxe             | `.hx`, `.hxml`, `haxelib.json`, `.haxerc`                     |
| Helm             | `helmfile.yaml`, `Chart.yaml`                                 |
| Java             | `.java-version`                                               |
| Julia            | `.jl` files, `Project.toml`, `Manifest.toml`                  |
| Kotlin           | `.kt`, `.kts` files                                           |
| Lua              | `.lua` files, `stylua.toml`, `.luarc.json`, `lua/` dir        |
| Maven            | `pom.xml`                                                     |
| Meson            | `MESON_DEVENV=1` and `MESON_PROJECT_NAME` environment         |
| Mojo             | `.mojo` files                                                 |
| Nim              | `.nim`, `.nims`, `.nimble`, `nim.cfg`                         |
| Nix shell        | `IN_NIX_SHELL=pure` or `IN_NIX_SHELL=impure` environment      |
| Node.js          | `package.json`, `.nvmrc`, `.node-version`                     |
| OCaml            | `.opam`, `.ml`, `.mli`, `dune`, `_opam/`, `esy.lock/`         |
| Odin             | `.odin` files                                                 |
| OPA/Rego         | `.rego` files                                                 |
| Perl             | `.pl`, `.pm`, `Makefile.PL`, `cpanfile`, `META.*`             |
| PHP              | `composer.json`                                               |
| Pixi             | `pixi.toml`, `pixi.lock`, `PIXI_ENVIRONMENT_NAME` environment |
| Pulumi           | `Pulumi.yaml`, `Pulumi.yml`                                   |
| PureScript       | `.purs` files, `spago.dhall`, `spago.yaml`, `spago.lock`      |
| Python           | `pyproject.toml`, `requirements.txt`, `setup.py`, `Pipfile`   |
| R                | `.R`, `.Rmd`, `.Rproj`, `DESCRIPTION`, `.Rproj.user/`         |
| Raku             | `.raku`, `.rakumod`, `.p6`, `.pm6`, `META6.json`              |
| Red              | `.red`, `.reds` files                                         |
| Ruby             | `Gemfile`, `.ruby-version`                                    |
| Rust             | `Cargo.toml`                                                  |
| Scala            | `.scala`, `.sbt`, `build.sbt`, `.metals/`                     |
| Solidity         | `.sol` files                                                  |
| Spack            | `SPACK_ENV` environment                                       |
| Swift            | `.swift` files, `Package.swift`                               |
| Terraform        | `.tf`, `.tfplan`, `.tfstate`, `.terraform/`                   |
| Typst            | `.typ` files, `template.typ`                                  |
| Vagrant          | `Vagrantfile`                                                 |
| V                | `.v` files, `v.mod`, `vpkg.json`                              |
| Xmake            | `xmake.lua`                                                   |
| Zig              | `.zig` files, `build.zig`                                     |

## Install

```bash
# From npm
pi install npm:pi-zentui

# From git
pi install git:github.com/lmilojevicc/pi-zentui
```

## Config

User config lives at `~/.pi/agent/zentui.json`. The file is optional: missing or invalid known values fall back to Zentui defaults, unknown keys are ignored at runtime, and `/zentui` can patch color-source settings, UI feature toggles, built-in footer segment visibility, and active third-party status placements.

The interactive `/zentui` menu is split into five sections. Use `Tab` and `Shift+Tab` to switch between `Coloring`, `Features`, `Layout`, `Built-in segments`, and `Extension segments`.

Useful slash-command shortcuts:

```text
/zentui editor enable
/zentui editor disable
/zentui statusline enable
/zentui statusline disable
/zentui editor toggle
/zentui statusline toggle
/zentui copy-friendly enable
/zentui copy-friendly disable
/zentui copy-friendly toggle
/zentui fixed-editor enable
/zentui fixed-editor disable
/zentui fixed-editor toggle
/zentui format "$cwd on branch $git_branch$git_status using $runtime $fill $context"
/zentui format clear
```

Default config values — copy this and change any value you want:

```json
{
	"projectRefreshIntervalMs": 30000,
	"footerFormat": "",
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
	"gitBranch": {
		"maxLength": "full"
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
		"os": ""
	},
	"colors": {
		"cwd": "bold cyan",
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
	},
	"colorSources": {
		"starship": "theme",
		"editor": "theme",
		"userMessages": "theme"
	},
	"features": {
		"editor": true,
		"statusLine": true,
		"copyFriendly": false
	},
	"footerSegments": {
		"cwd": true,
		"gitBranch": true,
		"gitStatus": true,
		"gitCounts": false,
		"runtime": true,
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
	},
	"fixedEditor": {
		"enabled": false,
		"mouseScroll": true,
		"copyNotice": true
	}
}
```

- Style values can be Starship/terminal strings (`bold purple`, `fg:202`, `#89b` / `#89b4fa`, `bg:blue fg:bright-green`) or Pi theme tokens (`accent`, `borderMuted`, `thinkingHigh`). Short `#rgb` hex values expand to `#rrggbb`.
- `projectRefreshIntervalMs`: project status polling interval; `0` disables polling. Values `1..4999` clamp up to `5000` (minimum 5s); invalid/non-finite values fall back to `30000`.
- `contextStyle`: `text` (default), `gauge`, or `text+gauge` for the context segment.
- `separator`: controls the default footer layout and extension-status connectors: `pipe` (default, ` | `), `dot` (` · `), `chevron` (` › `), or `none` (one space). Cycle it from the `/zentui` **Layout** tab. This selects the separator glyph; `colors.separator` controls its color. Custom `footerFormat` literals and `$sep` keep their existing behavior.
- `contextThresholds`: `{ warning, error }` percentages (default `70` / `90`) that select contextNormal / contextWarning / contextError colors.
- `pathDisplay`: controls how the cwd/`$cwd` path is shown. `mode` is `basename` (default, last segment only) or `full` (path with home contracted to `~`). In `full` mode, `depth` keeps only the last N trailing directories (`0` = entire path after `~`, max `5`); when parents are dropped the path is prefixed with `…/` (Starship-style). The `/zentui` **Layout** tab cycles path mode and path depth (`0`–`5`; depth is ignored for basename). Example: `~/Projects/foo/bar` with `depth: 2` → `…/foo/bar`.
- `gitBranch.maxLength`: visible width of the built-in branch name and `$git_branch` / `$branch`. The default `full` preserves the complete name; any positive integer uses that width including the trailing `…`. `/zentui` **Layout** cycles `full`, `10`, `20`, `30`, `40`, and `50`; custom positive integers can be set in JSON.
- `icons`: every shown icon key is configurable; omit any key to use the Zentui default. `icons.mode` is `auto` | `nerd` | `ascii` (default `auto`, same glyphs as nerd). ASCII mode swaps in plain fallbacks for statusline icons and runtime symbols — useful without a Nerd Font. Custom per-icon strings always win over mode defaults. Custom `icons.os` always wins; when left at the mode default, Zentui maps the OS icon by platform. `rail` sets the vertical glyph drawn as the left rail of the active editor frame and previous user messages when `copyFriendly` is disabled (default `│`; any single Unicode vertical or block glyph). `editorPrompt` controls an optional copy-friendly editor prompt glyph; the default is `""` so copy-friendly mode stays rail-free.
- `colorSources`: `theme` maps styles through Pi theme tokens; `terminal` emits terminal colors. `/zentui` switches these sources; manual JSON controls specific style values.
- `features`: `editor` enables Zentui's custom editor, selector borders, and previous-message chrome. `statusLine` enables Zentui's custom footer/status line. `copyFriendly` hides editor and previous-message rail glyphs so native terminal selection copies less chrome. All three can be changed from `/zentui` or direct slash-command arguments.
- `footerSegments`: show or hide individual built-in footer segments (`cwd`, `gitBranch`, `gitStatus`, `gitCounts`, `gitCommit`, `gitMetrics`, `runtime`, `packageVersion`, `sessionDuration`, `username`, `time`, `os`, `context`, `tokens`, `cost`). Toggle them from the `Built-in segments` tab in `/zentui`.
- `footerFormat`: optional Starship-style template string that fully controls the footer layout. When set, it overrides `footerSegments`. See [Footer Format Template](#footer-format-template) below. The `/zentui` **Layout** tab configures context style, separator, path display mode/depth, branch length, and icon mode; set or clear custom formats with `/zentui format`.
- `gitCommit`: Starship [`git_commit`](https://starship.rs/config/#git-commit)-style options for the `gitCommit` footer segment. `hashLength` (default `7`, clamped to `4`–`40`) controls the short-hash display length. `onlyDetached` (default `true`) shows the hash mainly on detached HEAD. `showTag` (default `true`) appends an exact-match tag (`git describe --tags --exact-match HEAD`). The tag probe piggybacks on the existing git refresh — it only runs when both the segment and `showTag` are on, and misses/failures degrade silently.
- `gitMetrics`: Starship [`git_metrics`](https://starship.rs/config/#git-metrics)-style options for the `gitMetrics` footer segment. Uses `git diff HEAD --numstat` (staged + unstaged combined — the Starship “total dirty” view) to show aggregate `+added −deleted` line counts. `onlyNonzero` (default `true`) omits each zero component independently and hides the segment entirely at `0/0`. `ignoreSubmodules` (default `false`) adds `--ignore-submodules=all`. The numstat diff piggybacks on the existing git refresh and uses a hard 2s timeout; a metrics-only failure degrades silently without discarding fresh branch/status data. On very large monorepos the diff may lag or be omitted on timeout.
- `extensionStatuses`: controls third-party statuses published by other Pi extensions through `ctx.ui.setStatus()`. `defaultPlacement` and each `placements` value can be `off`, `left`, `middle`, or `right`. The `Extension segments` tab in `/zentui` lists only statuses that are currently active.
- The shown `editor*` values match the default `theme` source. Omit those keys to keep Zentui's source-aware defaults when switching between `theme` and `terminal`.
- `editorAccent` styles the active editor rail and previous user-message rail when `features.copyFriendly` is disabled.
- `editorPrompt` styles the copy-friendly editor prompt glyph. Omit it to use `editorAccent`, then the default accent fallback.
- `editorBorder` styles the active editor and previous user-message top/bottom border color only; the border glyph stays `─`.
- `editorModel`, `editorProvider`, and `editorThinking*` style the editor metadata. `editorThinking` applies to every non-`off` thinking level unless a level-specific key is set.

Tip: when using copy-friendly mode, setting Pi's `editorPaddingX` to `1` in `~/.pi/agent/settings.json` keeps a small left gutter without copying a rail glyph.

## Footer Format Template

For full control, set a Starship-style `footerFormat` template string. It supports `$variable` and `${variable}` tokens, a special `$fill` token that splits the line into left and right zones, and conditional groups `( ... )` that drop entirely when every nested variable is empty. When set, it overrides the built-in `footerSegments` layout; when empty or omitted, the segment layout above is used.

A second `$fill` creates a **centered middle zone** — content between the two fills is true-centered (`floor((gap - middle) / 2)`), just like third-party statuses placed `middle`.

```json
{
	"footerFormat": "$os $username $cwd( on $git_branch)( $git_status)( via $runtime)$fill($context)($sep$tokens)($sep$cost)($sep$time)"
}
```

Center the branch between directory and cost:

```json
{
	"footerFormat": "$cwd $fill $git_branch $fill $cost"
}
```

### Variables

| Token               | Aliases      | Renders                                                             |
| ------------------- | ------------ | ------------------------------------------------------------------- |
| `$cwd`              | `$directory` | current directory                                                   |
| `$git_branch`       | `$branch`    | git branch with icon                                                |
| `$git_status`       | `$status`    | `[!?↑]` status block                                                |
| `$git_state`        | `$state`     | `REBASING` / `MERGING` / … (optional `n/m`)                         |
| `$git_commit`       | `$commit`    | short commit hash (+ exact-match tag when present)                  |
| `$git_tag`          | `$tag`       | exact-match tag at HEAD                                             |
| `$git_metrics`      |              | aggregate line changes `+added −deleted`                            |
| `$git_added`        |              | added line count (`+N`)                                             |
| `$git_deleted`      |              | deleted line count (`−N`)                                           |
| `$runtime`          |              | runtime icon + version                                              |
| `$package`          |              | project package version, `is <glyph> <version>` (manifest-derived)  |
| `$package_version`  |              | raw project package version (no icon)                               |
| `$session_duration` | `$duration`  | session running time                                                |
| `$username`         |              | `user@host`                                                         |
| `$os`               |              | operating-system icon                                               |
| `$time`             |              | current time `HH:MM`                                                |
| `$context`          |              | context usage (text and/or gauge via config)                        |
| `$tokens`           |              | input/output token counts                                           |
| `$cost`             |              | session cost                                                        |
| `$sep`              | `$separator` | themed `\|` using `colors.separator`            |
| `$fill`             | —            | special: splits zones                                               |

### `$fill` behavior

| `$fill` count | Layout                                                                   |
| ------------- | ------------------------------------------------------------------------ |
| 0             | everything left-aligned                                                  |
| 1             | tokens before → left, tokens after → right                               |
| 2             | before first → left, between → **centered middle**, after second → right |
| 3+            | first two count; extras ignored                                          |

- Literal text (`on branch`, `using`, `\|`, spaces) is rendered verbatim — you control all spacing.
- Each variable renders its core value only (no `on`/`via` prefixes); add those words as literal text.
- Conditional groups: wrap optional pieces in parentheses, e.g. `$cwd( on $git_branch)($git_status)$fill($context)`. If every `$var` inside a group is empty, the whole group (including its literals) is dropped.
- Unknown `$variables` render empty.
- Set or clear at runtime: `/zentui format "<template>"` and `/zentui format clear`.

## Fixed editor (experimental, opt-in)

The fixed editor pins the Zentui editor and footer at the bottom of the terminal while the transcript scrolls above. This enables composing follow-up messages while referencing earlier conversation history.

### How to enable

```text
/zentui fixed-editor enable
```

Or in `~/.pi/agent/zentui.json`:

```json
{
	"fixedEditor": {
		"enabled": true
	}
}
```

### Keyboard controls

| Key | Action |
| --- | ------ |
| `PageUp` / `PageDown` | Scroll transcript one viewport up/down |
| `Ctrl+Shift+↑` / `Ctrl+Shift+↓` | Scroll transcript up/down (Kitty protocol variants supported) |
| `Enter` | Jump to bottom (and submit message) |

### Mouse scroll (default on)

Mouse wheel scrolling is enabled by default when the fixed editor is on. Disable it via `/zentui` Features or:

```json
{
	"fixedEditor": {
		"enabled": true,
		"mouseScroll": true
	}
}
```

**Warning**: Mouse scroll enables SGR mouse reporting, which disables native terminal text selection, URL click-through, and tmux/Herdr scrollback for the Pi session. Toggle off if you need those features.

### Conflicts and limitations

- **Incompatible with** `pi-powerline-footer`, `@tifan/pi-fixed-editor`, and `pi-sticky-input`. These packages patch the same Pi TUI internals; only one rendering owner can be active at a time.
- **Alternate screen**: Uses the terminal's alternate screen buffer. Native scrollback history is not accessible while the fixed editor is active.
- **Pi version fragility**: Patches internal TUI methods (`doRender`, `render`, `terminal.write`, `terminal.rows`) that may change across Pi versions. If the TUI layout is unsupported, Zentui falls back to normal rendering with a console warning.
- If your terminal is stuck after a crash, run `reset` or restart the terminal.

## Requirements

- [Pi](https://pi.dev) coding agent 0.80 or newer
- A [Nerd Font](https://www.nerdfonts.com/) for icons (or set `icons.mode` to `"ascii"`)

## Development

```bash
npm install
npm run verify
npm run fmt
npm run pack:check
```

### Test in Pi

The project keeps Pi core packages as peer dependencies for runtime and dev dependencies for
typechecking. To avoid accidentally running the local `node_modules/.bin/pi` shim, the dev scripts use
the globally installed Pi binary by default:

```bash
npm run pi:dev
npm run pi:install-local
```

Override the binary if your Pi install is somewhere else:

```bash
PI_BIN=/path/to/pi npm run pi:dev
```

## Credits

Inspired by:

- [Starship](https://starship.rs/) — the minimal, blazing-fast, and infinitely customizable prompt
- [Opencode](https://github.com/opencode-ai/opencode) — terminal-based AI coding assistant

## License

MIT
