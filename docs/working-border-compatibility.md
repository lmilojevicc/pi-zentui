# Working border and editor focus

Border placement requires an enabled, visible Zentui editor with safe rendered border geometry and Pi keyboard-input ownership. If the editor is hidden/replaced, a dialog or overlay takes input, or geometry is unsupported, Zentui restores the native Working row. Disabled/native components remain independent.

Host pane/app focus is different from Pi input ownership. A cursor-hiding extension should delegate editor rendering without changing `editor.focused`, then filter cursor presentation (including Pi's `CURSOR_MARKER`) while the host is unfocused. Even a temporary `focused = false` assignment inside a render can revoke border capability and reveal the native Working row; restoring `true` afterward does not prove safe geometry again.

For example, issue #181 identified an interaction with a personal `terminal-focus-cursor` extension that temporarily changed this flag on host blur. Its fix belongs in the cursor decorator: preserve keyboard ownership and hide cursor output only. Zentui cannot reliably distinguish that temporary assignment from a genuine dialog/overlay transfer through the public focus API, so it must not ignore or debounce blur.

## Troubleshooting

If pane switching or Spotlight moves Working above the editor only with other extensions loaded:

1. Compare Zentui alone with Zentui plus any editor/cursor-focus decorators, using explicit `-e` paths and `--no-extensions` for an isolated launch. Keep the same settings, host, and selected model; retain any required provider extension in both comparisons. Do not edit installed packages or saved settings for isolation.
2. Observe during genuine native streaming, then refocus. Synthetic extension `agent_start` events do not instantiate Pi's streaming Loader; injected CSI I/O alone is not a reproduction of the host event chain.
3. Check decorators for writes to `editor.focused` during render or host focus notifications. Preserve predecessor editor identity, genuine focus changes, render results/errors, and safe-geometry fallback.

`test/working-line-border-focus.integration.test.ts` checks the presentation-only decorator contract across both adapters, Static/Classic/KITT, genuine keyboard transfer, and fallback. It is not a live Herdr or native-streaming reproduction. Hardware cursor/IME, host mediation, and active extension load order still need live verification.
