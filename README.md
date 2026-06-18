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

- `󰝰 dirname` — current directory with icon
- `on  branch` — git branch with icon
- `[!?↑]` — git status indicators (modified, untracked, ahead/behind, stashed, etc.)
- `via  v5.5.0` — runtime detection with version and Starship-style Nerd Font runtime/language modules
- Right side shows context usage, token counts, and cost
- Built-in footer segments can be shown or hidden individually from `/zentui`
- Third-party Pi extension statuses from `ctx.ui.setStatus()` can be shown on the left,
  middle, or right side, or hidden per status key from `/zentui`

### Editor (Opencode-inspired)

- Bordered input box with configurable accent rail and border colors
- Model name and provider displayed inside the editor frame
- Configurable model, provider, and thinking-level indicator colors
- Prompt-box-style user messages matching the ZentUI input chrome
- Copy-friendly mode hides editor and previous-message rail glyphs so terminal selection copies less chrome

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

The interactive `/zentui` menu is split into four sections. Use `Tab` to switch between `Coloring`, `Features`, `Built-in segments`, and `Extension segments`.

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
```

Default config values — copy this and change any value you want:

```json
{
	"projectRefreshIntervalMs": 30000,
	"icons": {
		"cwd": "󰝰",
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
		"editorPrompt": ""
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
		"runtime": true,
		"context": true,
		"tokens": true,
		"cost": true
	},
	"extensionStatuses": {
		"defaultPlacement": "right",
		"placements": {},
		"colorModes": {}
	}
}
```

- Style values can be Starship/terminal strings (`bold purple`, `fg:202`, `#89b4fa`, `bg:blue fg:bright-green`) or Pi theme tokens (`accent`, `borderMuted`, `thinkingHigh`).
- `projectRefreshIntervalMs`: project status polling interval; `0` disables polling.
- `icons`: every shown icon key is configurable; omit any key to use the Zentui default. `editorPrompt` controls an optional copy-friendly editor prompt glyph; the default is `""` so copy-friendly mode stays rail-free.
- `colorSources`: `theme` maps styles through Pi theme tokens; `terminal` emits terminal colors. `/zentui` switches these sources; manual JSON controls specific style values.
- `features`: `editor` enables Zentui's custom editor, selector borders, and previous-message chrome. `statusLine` enables Zentui's custom footer/status line. `copyFriendly` hides editor and previous-message rail glyphs so native terminal selection copies less chrome. All three can be changed from `/zentui` or direct slash-command arguments.
- `footerSegments`: show or hide individual built-in footer segments (`cwd`, `gitBranch`, `gitStatus`, `runtime`, `context`, `tokens`, `cost`). Toggle them from the `Built-in segments` tab in `/zentui`.
- `extensionStatuses`: controls third-party statuses published by other Pi extensions through `ctx.ui.setStatus()`. `defaultPlacement` and each `placements` value can be `off`, `left`, `middle`, or `right`. The `Extension segments` tab in `/zentui` lists only statuses that are currently active.
- The shown `editor*` values match the default `theme` source. Omit those keys to keep Zentui's source-aware defaults when switching between `theme` and `terminal`.
- `editorAccent` styles the active editor rail and previous user-message rail when `features.copyFriendly` is disabled.
- `editorPrompt` styles the copy-friendly editor prompt glyph. Omit it to use `editorAccent`, then the default accent fallback.
- `editorBorder` styles the active editor and previous user-message top/bottom border color only; the border glyph stays `─`.
- `editorModel`, `editorProvider`, and `editorThinking*` style the editor metadata. `editorThinking` applies to every non-`off` thinking level unless a level-specific key is set.

Tip: when using copy-friendly mode, setting Pi's `editorPaddingX` to `1` in `~/.pi/agent/settings.json` keeps a small left gutter without copying a rail glyph.

## Requirements

- [Pi](https://pi.dev) coding agent 0.79 or newer
- A [Nerd Font](https://www.nerdfonts.com/) for icons

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
