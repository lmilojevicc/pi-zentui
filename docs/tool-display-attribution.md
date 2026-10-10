# Tool display reference and attribution

Zentui's native Tool display component uses [pi-tool-display 0.5.0](https://github.com/MasuRii/pi-tool-display/tree/91cef7580078371f8dc49a8607222807ad6a424d) as its visual/behavior reference. The mode names, preset selections, compact call/summary wording, adaptive diff presentation thresholds and hashline gutter conventions are adapted from its `types.ts`, `presets.ts`, `tool-overrides.ts`, `diff-presentation.ts`, `diff-renderer.ts`, `write-display-utils.ts` and `pending-diff-preview.ts`. The implementation is local to Zentui; it does not import upstream internals or read/write upstream configuration.

## Deliberate differences

- Default disabled; `native` also delegates to the existing renderer. No Thinking or User message settings/patches are installed.
- Uses Pi's public rendering-only resolver, not tool registration or execution interception. Existing execution, schemas and prompt metadata are unchanged.
- Stable native builtin renderer identities are compared with public tool-definition factories and public builtin source metadata. Pi 1.0.3/1.0.4 create fresh Bash renderer functions, so native Bash rendering cannot be distinguished from a rendering-only extension through `next()`. Bash therefore stays native unless the owner-local advanced `builtinRendererOverrides.bash` is explicitly `true`. This setting permits replacement of existing Bash **rendering**, never a foreign tool definition. Other advanced builtin flags follow the same provenance boundary.
- Custom/MCP matching requires exact names in `customToolOverrides`. An enabled entry only fills a renderless tool by default. Replacing an existing renderer requires that exact entry's `overrideExistingRenderers: true`; execution remains untouched. Omitted `outputMode` inherits the current MCP mode for `kind: "mcp"`, and summary for generic tools.
- Empty, image, mixed and unknown content delegates to the predecessor. Hidden modes do not hide errors. Pending Bash progress is event-driven rather than an independently timed spinner.
- Pending/write diffs require live, workspace-only preimages observed through public tool events. Render/history paths never read files. Unavailable preimages produce a notice instead of inventing an empty original file. The cache holds at most 16 entries / 1 MiB for 60 seconds; individual UTF-8 reads/projections are bounded to 256 KiB. Symlinks, external paths, special/binary/unreadable files are rejected. Integrators must clear this cache on session replacement, tree changes, reload and shutdown.
- A row that delegates to its predecessor remains delegated through completion (including errors/mixed output/fallbacks), so predecessor-owned timers and state get their final rendering callback. New rows or a real rebuild/reload may acquire rendering again. Modes update live while a row is still owned. Release latches use weak references to public per-row state, not a growing tool-call ID registry.
- Diff lines use host theme tokens and bold word-span emphasis, not upstream's custom RGB background palette. Optional host highlighting is injected. Adaptive summary (<8 columns), compact (<18), unified and split layouts fit terminal columns using public TUI utilities. Large diff computation is bounded; collapsed limits count rendered visual lines. Generated previews omit distant unchanged context. Text input is capped at 1 MiB; diff parsing at 8,000 lines, generated diffs at 4,000 lines per side, and displayed expanded text at 20,000 logical lines. Limits/omissions are reported rather than presented as complete output. This is not a pixel-identical port or a claim of complete upstream parity.

## Upstream MIT notice

MIT License

Copyright (c) 2026 MasuRii

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
