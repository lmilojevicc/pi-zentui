# Contributing to pi-zentui

Thanks for your interest in pi-zentui. This document covers the workflow and conventions used in this repository.

## Development setup

Requirements: Node.js and npm. pi-zentui is a Pi extension package, so you'll also want a working `pi` binary for local testing.

```bash
npm install
npm run verify      # biome check + tsc --noEmit + vitest run
npm run pack:check  # npm pack --dry-run, sanity-checks published contents
```

Before opening a pull request, please run `npm run fmt` and then `npm run verify` again.

## Local Pi testing

The package is loaded by Pi from `package.json` via the `pi.extensions` field. Use the dev scripts to iterate without publishing:

```bash
npm run pi:dev              # runs pi with only this extension loaded
npm run pi:install-local    # installs the local checkout into your pi extensions
```

`pi` is resolved from `PATH`, so the same commands work on macOS, Linux and Windows.
Override the binary when it is not on `PATH`, and forward any Pi flags after `--`:

```bash
PI_BIN=/absolute/path/to/pi npm run pi:dev
npm run pi:dev -- --model provider/model
```

Extensions are isolated by default (`--no-extensions -e ./extensions/zentui/index.ts`).
Add `--keep-extensions` when the session needs an extension-provided provider or model,
or when resuming a session that used one:

```bash
npm run pi:dev -- --keep-extensions -- --session <id>
```

`--keep-extensions` also loads an installed `pi-zentui`, so the session contains two
copies of this extension. Extension render resolvers compose in load order (Pi's
`resolveToolRenderers` makes the first-loaded resolver outermost) and both copies claim
the `$` row when `builtinRendererOverrides.bash` is true, so only the first-loaded one
owns it; the copies also compete for `/zentui`, the footer and the editor. Disable the
installed copy, or use `npm run pi:install-local`, when verifying row changes.
Manual testing is required for any change that affects the footer, editor, user-message styling, runtime/git detection, colors, or `/zentui` settings.

## Coding expectations

Please follow the conventions already in this repo. The most important ones:

- **Preserve Nerd Font / private-use icon glyphs.** Many of the icons are private-use Unicode characters; it is easy to replace them with empty strings by accident.
- **Keep `extensions/zentui/index.ts` orchestration-focused.** Rendering, formatting, and parsing logic belong in focused modules such as `footer.ts`, `format.ts`, `style.ts`, `git.ts`, `runtime.ts`, `ui.ts`, or `user-message.ts`.
- **Use focused modules.** New rendering or formatting code should generally go into the matching module rather than being inlined.
- **Silent fallbacks are intentional.** Git, runtime detection, and config lookups fail silently so that a broken environment does not break the session. Do not add throws or noisy errors for these paths without a strong reason.
- **`user-message.ts` patches `UserMessageComponent`.** Treat it as fragile and avoid changes unless they are necessary.
- **Runtime color values follow Starship's terminal style strings** (e.g. `bold purple`, `fg:202`, `bg:blue`).
- **Use explicit `.ts` import specifiers for relative imports** (e.g. `./config.ts`) in the shipped sources (`extensions/**` and `omp.ts`). Pi loads these sources through jiti, which probes many candidate paths for extensionless or `.js` specifiers; explicit specifiers cut the module-resolution cost of every session start. `test/import-specifiers.test.ts` enforces this.

## Pull request expectations

- Describe the user-facing behavior change in the PR summary.
- Include screenshots or a short recording for footer, editor, user-message, or rendering changes.
- Run `npm run verify` and `npm run pack:check` locally.
- Keep the diff surgical. Don't refactor adjacent code, reformat unrelated files, or upgrade dependencies that aren't part of the fix.
- Use a conventional commit-style subject (e.g. `feat: add ...`, `fix: handle ...`), lowercase after the type, imperative, and concise. No trailing period.
- Reviews are assigned to `@lmilojevicc` via `CODEOWNERS`.

## Reporting issues

Please use the GitHub issue forms in [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/) so reports include the environment, config, and Pi/Zentui version context needed to triage them:

- Bug report
- Rendering, icon, or color issue
- Feature request
- Runtime/language detection
- Config or usage question

For core Pi issues outside Zentui's footer, editor, and message styling, please open the issue upstream in the Pi project instead.

## License

By contributing, you agree that your contributions will be licensed under the MIT license that covers this project. See [`LICENSE`](LICENSE) for the full text.
