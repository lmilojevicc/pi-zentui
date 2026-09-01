<h1 align="center">Zentui</h1>

<p align="center">A Starship-inspired statusline and Opencode-style TUI for <a href="https://pi.dev">Pi</a>.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pi-zentui"><img alt="npm version" src="https://shieldcn.dev/npm/pi-zentui.svg?variant=outline" /></a>
  <a href="https://www.npmjs.com/package/pi-zentui"><img alt="npm monthly downloads" src="https://shieldcn.dev/npm/dm/pi-zentui.svg?variant=outline" /></a>
  <a href="https://github.com/lmilojevicc/pi-zentui/actions/workflows/ci.yml"><img alt="CI status" src="https://shieldcn.dev/github/ci/lmilojevicc/pi-zentui.svg?workflow=ci.yml&amp;branch=main&amp;variant=outline" /></a>
  <a href="https://github.com/lmilojevicc/pi-zentui/graphs/contributors"><img alt="GitHub contributors" src="https://shieldcn.dev/github/contributors/lmilojevicc/pi-zentui.svg?variant=outline" /></a>
  <a href="https://github.com/lmilojevicc/pi-zentui/blob/main/LICENSE"><img alt="MIT license" src="https://shieldcn.dev/github/license/lmilojevicc/pi-zentui.svg?variant=outline" /></a>
</p>

![Screenshot of Zentui with a framed user message, spacious Opencode Editor, model metadata, and Starship Footer.](https://raw.githubusercontent.com/lmilojevicc/pi-zentui/main/assets/main-cover.png)

## What is this?

Zentui gives Pi surfaces independent, opt-in treatments:

- **Editor** — Opencode, Opencode copy-friendly, Accent Rail, and Minimalist input treatments
- **User messages** — framed, framed copy-friendly, compact, and labeled transcript messages
- **Thinking (Experimental)** — optional Rail, Tree, or Streaming private thinking renderers, without owning the Working line
- **Working line** — optional ownership of Pi's complete in-progress row and settled turn summary
- **Footer** — Pi's native Footer, a Starship-style statusline, or a hidden zero-row Footer

Editor, User messages, Thinking (Experimental), Working line, and selector borders have independent `enabled` fields. Footer uses one `style`: `native`, `starship`, or `hidden`. Use `/zentui` to configure each component without coupling it to the others.

## Highlights

| Surface | Default | Available treatments |
| --- | --- | --- |
| Editor | `opencode` | Opencode, copy-friendly, Accent Rail, Minimalist |
| User messages | `framed` | Framed, copy-friendly, Compact, Labeled |
| Thinking (Experimental) | disabled (`tree`) | Rail, Tree, Streaming |
| Working line | disabled | Five spinner presets, live tool/time/thinking/token segments, turn summary |
| Footer | `starship` | Native, Starship, Hidden |
| Selector borders | `zentui` | Independent enablement and color source |

The Starship Footer shows directory, Git, runtime, context, tokens, and cost. Optional segments include model/provider, package version, session duration, `user@host`, time, OS, Git commit, Git metrics, and third-party extension statuses. The layout is segment-driven by default and supports a complete Starship-style format template.

Zentui detects a broad set of runtime and language modules, preserves Nerd Font icons with an ASCII mode, and can source colors from the active Pi theme or directly from the terminal palette.

## Screenshots

### Editors

<h4 align="center"><code>opencode</code></h4>

![Zentui Opencode editor with an accent rail, model metadata, Nerd Font Git branch, and Starship footer.](https://raw.githubusercontent.com/lmilojevicc/pi-zentui/main/assets/screenshots/editor-opencode.png)

<h4 align="center"><code>opencode-copy-friendly</code></h4>

![Zentui copy-friendly Opencode editor with model metadata, Nerd Font Git branch, and Starship footer.](https://raw.githubusercontent.com/lmilojevicc/pi-zentui/main/assets/screenshots/editor-opencode-copy-friendly.png)

<h4 align="center"><code>accent-rail</code></h4>

![Zentui Accent Rail editor with a filled single-left-rail input and Starship footer.](https://raw.githubusercontent.com/lmilojevicc/pi-zentui/main/assets/screenshots/editor-accent-rail.png)

<h4 align="center"><code>minimalist</code></h4>

![Zentui Minimalist editor with session, cost, model, Git, and path metadata in a rounded frame with the Footer hidden.](https://raw.githubusercontent.com/lmilojevicc/pi-zentui/main/assets/screenshots/editor-minimalist.png)

### User messages

<h4 align="center"><code>framed</code></h4>

![Zentui Framed user-message style with horizontal borders, spacer rows, and an accent rail.](https://raw.githubusercontent.com/lmilojevicc/pi-zentui/main/assets/screenshots/user-message-framed.png)

<h4 align="center"><code>framed-copy-friendly</code></h4>

![Zentui copy-friendly Framed user-message style with horizontal borders, spacer rows, and a copyable left edge.](https://raw.githubusercontent.com/lmilojevicc/pi-zentui/main/assets/screenshots/user-message-framed-copy-friendly.png)

<h4 align="center"><code>compact</code></h4>

![Zentui Compact user-message style with a slim accent rail and no surrounding borders.](https://raw.githubusercontent.com/lmilojevicc/pi-zentui/main/assets/screenshots/user-message-compact.png)

<h4 align="center"><code>labeled</code></h4>

![Zentui Labeled user-message style in a rounded frame with the label User.](https://raw.githubusercontent.com/lmilojevicc/pi-zentui/main/assets/screenshots/user-message-labeled.png)

## Install

```bash
# From npm
pi install npm:pi-zentui

# From git
pi install git:github.com/lmilojevicc/pi-zentui
```

## Configure

Run `/zentui` inside Pi to configure Appearance, Editor, User messages, Thinking (Experimental), Working line, Footer, Segments, Git, and Extensions. Use `Tab` and `Shift+Tab` to switch sections. Most changes apply live; Thinking (Experimental) changes are saved and require restarting Pi. Configuration is saved to:

```text
~/.pi/agent/zentui.json
```

A small starter config:

```json
{
  "components": {
    "editor": {
      "enabled": true,
      "style": "accent-rail"
    },
    "userMessages": {
      "enabled": true,
      "style": "framed"
    },
    "thinkingSteps": {
      "enabled": false,
      "mode": "tree"
    },
    "workingLine": {
      "enabled": false
    },
    "footer": {
      "style": "starship"
    }
  },
  "icons": {
    "mode": "auto"
  }
}
```

Detailed reference:

- [Configuration, component styles, defaults, runtime detection, and compatibility](https://github.com/lmilojevicc/pi-zentui/blob/main/docs/configuration.md)
- [Footer format template and variables](https://github.com/lmilojevicc/pi-zentui/blob/main/docs/footer-format.md)

The Starship Footer path defaults to `basename`. Opt into `components.footer.styles.starship.pathDisplay.mode: "repository"` to omit the repository directory itself: the repository root renders `.`, while `/repo/extensions/zentui` renders `extensions/zentui`. `depth` keeps the final N components in `full` and `repository` modes; `0` is unlimited. Until a current, safely contained repository root is available, repository mode silently uses the unlimited `full` path with `~` home abbreviation.

Useful shortcuts:

```text
/zentui editor toggle
/zentui messages toggle
/zentui working-line
/zentui statusline toggle
/zentui viewport-indicators toggle
/zentui format "$cwd on branch $git_branch$git_status using $runtime $fill $context"
/zentui format clear
```

**Thinking (Experimental)** uses one restart-gated private `AssistantMessageComponent` renderer for Rail, Tree, and Streaming, tested against exact Pi versions 0.80.5, 0.83.0, 0.84.0, and 0.84.4. It is disabled by default and may break after Pi updates. Every enable, disable, or mode change is saved but does not alter the active startup snapshot; restart Pi to apply it. Zentui installs an enabled startup snapshot before transcript restoration. Missing constructors, incompatible child layouts, parser limits, theme/render/width errors, or displaced patch ownership fail open to complete native thinking rather than switching modes.

Rail shows every parsed label in each native contiguous thinking run (`│ Label`, with only the open final phase shown as `│ • Label`). Tree independently shows the latest five labels in each run (`├─ · Label`, settled `└─ · Label`, open `└─ • Label`); it never aggregates across intervening text or tool blocks. Labels are rendered by fresh host-shaped Pi Markdown instances before cropping, so emphasis, code, links, HTML, LaTeX, custom transforms, and native `thinkingText` styling remain host-controlled. Every label occupies one terminal row: ANSI/OSC/grapheme-aware cropping adds `…` only when needed. Native horizontal padding stays external. Connectors are styled directly with the current theme's `accent` callback on every render, so custom themes control them independently. Hidden native thinking remains hidden and keeps Pi's native hidden label.

Streaming retains Pi's host-rendered final five rows under `Thinking 7.1s`, folds completed reasoning under `Thought` or current-session `Thought for 12.3s`, and owns the configured thinking-toggle binding (Ctrl+T by default) only for an active Streaming startup. Restored completions cannot recover a duration because Pi does not persist the thinking-end timestamp. Expand/refold and lifecycle tracking are bounded to 256 retained assistant components; evicted entries are first restored natively. All modes restore/dispose on shutdown. Thinking (Experimental) never writes the Working line and does not change its existing **Thinking time** option, working text, Footer, Editor, statuses, or model behavior.

Pi 0.84 also provides a native fullscreen TUI with a sticky editor and Footer. Zentui does not enable it automatically; select fullscreen from Pi's `/settings`, set `"tuiMode": "fullscreen"` in Pi settings, or launch Pi with `--tui-mode fullscreen`.

## Requirements

- [Pi](https://pi.dev) coding agent 0.80.5 or newer
- A [Nerd Font](https://www.nerdfonts.com/) for icons, or `icons.mode: "ascii"`

## Development

```bash
npm install
npm run fmt
npm run verify
npm run pack:check
```

Run Pi with only the local extension:

```bash
npm run pi:dev
```

Install the checkout as a local Pi package:

```bash
npm run pi:install-local
```

Override the globally installed Pi binary when needed:

```bash
PI_BIN=/path/to/pi npm run pi:dev
```

See [CONTRIBUTING.md](https://github.com/lmilojevicc/pi-zentui/blob/main/CONTRIBUTING.md) for manual UI-test and pull-request expectations.

## Inspiration and credits

- [Starship](https://starship.rs/) — inspiration for the informative, segment-based Footer
- [Opencode](https://github.com/anomalyco/opencode) — inspiration for the Opencode editor treatment
- [Oh My Pi (`omp`)](https://github.com/can1357/oh-my-pi) by [Can Bölük](https://github.com/can1357) — visual inspiration for the filled, single-left-rail Accent Rail editor
- [Pi Custom Input](https://github.com/VinhLe1410/pi-custom-input) by [Vinh Le](https://github.com/VinhLe1410) — visual inspiration for Minimalist's framed, border-embedded session, model, context, Git, and path metadata
- [Pi Thinking Steps](https://github.com/crustyhacker/pi-thinking-steps) by Marc Mironescu / FluxGear — structural-step parsing and the Rail/Tree visual language; adapted in Thinking (Experimental) under the MIT License
- [Pi Thinking Fold](https://github.com/99percentpeople/pi-extensions/tree/master/extensions/thinking-fold) by [Zach Yuen](https://github.com/99percentpeople) — native rendered-row folding, timing, expand/refold behavior, and fail-open compatibility patterns; adapted in Thinking (Experimental) under the MIT License

Most Zentui implementations are independent; these credits acknowledge product and visual inspiration. Thinking (Experimental) also adapts MIT-licensed implementation work from Pi Thinking Steps and Pi Thinking Fold. Their complete copyright and permission notices are retained in the packaged [`thinking-experimental.ts`](./extensions/zentui/thinking-experimental.ts) source.

## License

Zentui is licensed under the MIT License. Wallpaper photo by [Mohammad Alizade](https://unsplash.com/@mohamadaz) on [Unsplash](https://unsplash.com/photos/SB5MIXFjJxs), used under the [Unsplash License](https://unsplash.com/license). The photograph appearing in showcase screenshots is not relicensed under MIT.
