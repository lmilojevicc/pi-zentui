# Zentui

A Starship-inspired statusline and Opencode-style TUI for [Pi](https://pi.dev).

## Screenshots

![Zentui](https://raw.githubusercontent.com/lmilojevicc/pi-zentui/main/assets/zentui.png)

## What is this?

Zentui brings two popular aesthetics to Pi:

- **[Starship](https://starship.rs/) footer** — shows your current directory, git branch, git status indicators, and runtime/version detection in a compact, icon-rich format
- **[Opencode](https://github.com/opencode-ai/opencode) editor** — clean bordered input box with accent rail and model/provider display inside the editor frame

## Features

### Footer (Starship-inspired)

- `󰝰 dirname` — current directory with icon
- `on  branch` — git branch with icon
- `[!?↑]` — git status indicators (modified, untracked, ahead/behind, stashed, etc.)
- `via  v5.5.0` — runtime detection with version (Bun, Deno, Node, Python, Go, Rust, Lua, Java, Ruby, PHP)
- Right side shows context usage, token counts, and cost

### Editor (Opencode-inspired)

- Bordered input box with accent-colored left rail
- Model name and provider displayed inside the editor frame
- Thinking level indicator when enabled

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

Detects project type and shows runtime version:

| Runtime | Detection                                                   |
| ------- | ----------------------------------------------------------- |
| Bun     | `bun.lock`, `bun.lockb`                                     |
| Deno    | `deno.json`, `deno.jsonc`, `deno.lock`                      |
| Node.js | `package.json`, `.nvmrc`, `.node-version`                   |
| Python  | `pyproject.toml`, `requirements.txt`, `setup.py`, `Pipfile` |
| Go      | `go.mod`                                                    |
| Rust    | `Cargo.toml`                                                |
| Lua     | `stylua.toml`, `.luarc.json`, `init.lua`, `lua/` dir        |
| Java    | `pom.xml`, `build.gradle`                                   |
| Ruby    | `Gemfile`, `.ruby-version`                                  |
| PHP     | `composer.json`                                             |

## Install

```bash
# From npm
pi install npm:pi-zentui

# From git
pi install git:github.com/lmilojevicc/pi-zentui
```

## Config

On first run, Zentui creates a config file at:

```
~/.pi/agent/zentui.json
```

### Default config

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
    "typechanged": "T"
  },
  "colors": {
    "cwdText": "syntaxOperator",
    "git": "syntaxKeyword",
    "gitStatus": "error",
    "contextNormal": "muted",
    "contextWarning": "warning",
    "contextError": "error",
    "tokens": "muted",
    "cost": "success",
    "separator": "borderMuted"
  }
}
```

`projectRefreshIntervalMs` controls how often Zentui refreshes project status (git/runtime) while Pi is idle. Set it to `0` to disable polling; invalid values or values below 5000 ms fall back to `30000`.

### Color values

Colors can be:

- Pi theme token names (e.g., `accent`, `error`, `syntaxKeyword`)
- Hex colors (e.g., `#89b4fa`)

This means Zentui works with any Pi theme — it uses your theme's colors by default.

## Requirements

- [Pi](https://pi.dev) coding agent 0.74 or newer
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
