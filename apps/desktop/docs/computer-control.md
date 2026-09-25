# Windows computer control

Codex panes can connect to [Windows-MCP](https://github.com/CursorTouch/Windows-MCP)
through GatedSpace's authenticated local MCP bridge. This is separate from the
OpenAI desktop application's native controller; it does not reuse that app's
private pipe, binaries, or permissions.

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) on Windows.
In a Codex pane, choose the monitor icon beside the composer, then **Enable for
this pane**. First use prepares Windows-MCP 0.8.5 and its Python environment.
GatedSpace launches it over stdio only; it does not install a background service,
expose desktop control to the network, or alter global Codex configuration.
Anonymous telemetry and the UIA background watchdog are disabled.

The foreground Windows desktop must remain unlocked. Only one pane can hold the
grant. Stop using the visible square button or **Ctrl+Alt+Shift+Esc**. Closing the
owning pane, disconnecting Codex, locking, sleeping, or quitting revokes access.
Enable is a desktop UI action; it is not an agent-callable tool. Existing task
authorization still applies to sending messages, purchases, deletion and security
changes. Enabling desktop control is not blanket authorization for those actions.

While enabled, every display has a thin, click-through border. A draggable status
bar stays above other apps with the current action and a Stop button, without
taking keyboard focus. Idle control says "Computer control ready"; active actions
brighten the border and animate the status text. Reduced-motion preferences are
respected. Stopping destroys the overlay windows, and an unexpected overlay close
or renderer crash revokes desktop control.

`computer_tools` returns the currently supported schemas. `computer_call` proxies
one permitted UI tool at a time and preserves MCP screenshot image blocks. The
allowlist excludes Windows-MCP's shell, filesystem, registry, clipboard and
process-management tools. Prefer the embedded browser bridge for web work.

Verification:

- `bun test src/main/lib/computer-use` checks grants, cancellation and lifecycle.
- `bun run scripts/check-computer-controller.ts` checks the actual Windows-MCP
  handshake and tool inventory, then stops its process tree. It performs no
  screenshot or input actions.
- `bun run scripts/test-codex-session.ts` exercises the production composer with
  fixture IPC, including narrow panes. This is UI evidence, not a native-input test.
- `scripts/check-computer-overlay.ts`, bundled for Electron, verifies the actual
  overlay windows and tRPC Stop path with a simulated controller. Set
  `OVERLAY_BUNDLE` to the compiled `dist` directory to check release assets.

The controller runs under the signed-in Windows user's normal privileges. It does
not bypass elevation prompts or operate the locked desktop.
