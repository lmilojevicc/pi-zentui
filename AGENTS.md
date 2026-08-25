## What this app is

Zentui is a Pi extension package that gives Pi a Starship-inspired footer and an Opencode-style input UI.

It shows useful session/project state at a glance:

- current directory
- git branch and git status
- detected runtime/language and version
- context usage
- input/output token counts
- running session cost
- model/provider in the editor frame

## How it works

Pi loads the package from `package.json` via:

```json
"pi": {
  "extensions": ["./extensions"]
}
```

The extension entry point is:

```text
extensions/zentui/index.ts
```

On `session_start`, Zentui installs:

- a custom footer (`footer.ts`)
- a custom editor (`ui.ts`)
- custom user-message styling (`user-message.ts`)
- a project refresh timer for git/runtime status

Most updates happen by syncing shared footer state and asking the TUI to re-render after Pi events like model changes, message completion, tool completion, and compaction.

## Product decision: TUI composability

Zentui is a set of independently selectable TUI components, not a bundled UI mode. Users can adopt User messages, Editor, Working line, selector borders, Footer, or future surfaces individually while leaving every other surface native or controlled by another extension.

- Enabling or configuring one component must never require, toggle, restyle, or silently rewrite another. Each feature needs its own canonical config choice (`enabled` and/or `style` as appropriate), settings control, install/reconcile/dispose lifecycle, and ownership boundary.
- Disabled or native must leave that surface alone. Shared infrastructure must remain behavior-neutral.
- Prefer public Pi APIs. Safely decorate, aggregate, or delegate where possible; clean up only owned state; and fail open to native or predecessor UI.
- Treat the unkeyed Working line as controlled exclusivity with best-effort release, not true aggregation.
- Keep `index.ts` orchestration-only.

## Important files

- `extensions/zentui/index.ts` — extension orchestration and Pi event wiring.
- `extensions/zentui/config.ts` — config file path, defaults, and config merging.
- `extensions/zentui/footer.ts` — footer/statusline rendering.
- `extensions/zentui/style.ts` — Starship-style terminal style rendering (`bold purple`, `fg:202`, `bg:blue`, etc.).
- `extensions/zentui/format.ts` — small formatting helpers for counts, labels, context, cwd, and runtime segments.
- `extensions/zentui/state.ts` — footer state shape and sync logic.
- `extensions/zentui/git.ts` — git porcelain parsing and status summary.
- `extensions/zentui/runtime.ts` — runtime/language detection and version lookup.
- `extensions/zentui/settings-command.ts` — `/zentui` settings UI for color-source preferences.
- `extensions/zentui/ui.ts` — custom editor frame.
- `extensions/zentui/user-message.ts` — prompt-box-style user message rendering.

## Config

User config is created at:

```text
~/.pi/agent/zentui.json
```

Use `colors` for Starship-style color strings, hex/256-color values, or Pi theme tokens. Canonical color-source ownership is independent through `components.editor.colorSource`, `components.userMessages.colorSource`, `components.selectorBorders.colorSource`, and `components.footer.colorSource`. `/zentui` exposes separate controls for Editor, previous User messages, selector borders, and—while Starship is selected—the Footer; changing one does not change the others.

## Things to preserve

- Keep `index.ts` mostly orchestration; put rendering/formatting logic in focused modules.
- Preserve Nerd Font icons. Many are private-use Unicode characters and can be easy to accidentally replace with empty strings.
- Runtime color values should follow Starship's terminal style strings.
- `user-message.ts` intentionally patches `UserMessageComponent`; treat it as fragile and avoid changing it unless necessary.
- Silent fallbacks are intentional for git/runtime/config failures so the UI does not break the session.

## Development

Use these commands before shipping changes:

```bash
npm run fmt
npm run verify
npm run pack:check
```

For local Pi testing:

```bash
npm run pi:dev
npm run pi:install-local
```

## Commit style

Use conventional commit messages that match the existing history:

```text
feat: add user-facing capability
```

Keep the subject lowercase after the type, imperative, and concise. Do not use a trailing period.
