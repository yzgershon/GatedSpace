# Sidebar browser input isolation

Sidebar automation and Windows computer control are separate integrations. Sidebar
tools act on an owned page; they must not focus a desktop window, move the physical
pointer, change the clipboard, or send agent keystrokes to a session composer.

## Comparison and reproduced failure

The installed ChatGPT Chrome integration uses Chromium debugger input, virtual
page focus, and a pointer overlay that ignores mouse events. Chrome tabs have a
different focus hierarchy from Electron's embedded `webview` guests.

Two problems were reproduced in Electron 40.8.5 using hidden, isolated fixtures:

- Routine GatedSpace browser calls selected the target tool tab and changed the
  workspace's keyboard-focus group, even when the user was working elsewhere.
- A guest CDP mouse click changed the host's active element from the composer to
  the webview. Restoring composer focus alone exposed a second problem: CDP key
  events and `Input.insertText` resolved the outer focused widget and entered the
  composer instead of the guest field.

This matches [Chromium's keyboard routing](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/devtools/protocol/input_handler.cc):
the CDP keyboard handler resolves `GetFocusedRenderWidgetHost`.
[Electron's direct guest keyboard path](https://github.com/electron/electron/blob/v40.8.5/shell/browser/api/electron_api_web_contents.cc)
instead forwards to that guest's render widget. This behavior must remain covered
by native tests when upgrading Electron; a mocked CDP test cannot establish it.

## Implementation

- Only explicit open/select calls reveal a tab. Other calls prepare an owned
  guest without changing tab selection, panel visibility, or shortcut routing.
  Parked and restored guests can initialize in the background. Existing idle
  suspension and session ownership checks still apply.
- Mouse clicks use CDP with the existing preview scale correction. A short-lived
  host focus guard protects the user's active element, tracks user focus changes,
  and supports overlapping actions in different guests.
- Key presses use the direct guest event path while virtual page focus is active.
  They never use CDP keyboard routing or Windows input. Fill targets the selected
  guest element. A temporary Tab boundary keeps navigation from leaving the page
  for another pane. Input errors are returned without replaying an action.
- A page-local Codex/Claude cursor marks actions. Its shadow-root overlay has
  `pointer-events: none`, is hidden from accessibility navigation, respects reduced
  motion, and expires automatically. It never moves the Windows pointer.

## Verification

Run from `apps/desktop`:

```powershell
bun test src/main/lib/browser/agent-browser-input.test.ts src/main/lib/browser/agent-browser-service.test.ts 'src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceToolPanels/agent-browser-tab.test.ts' 'src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceToolPanels/tool-panel-store.test.ts'
bun scripts/test-workspace-tools.ts
```

The native harness exercises the actual sidebar registry and browser adapter in a
hidden Electron window. It checks composer focus, draft selection and contents,
guest typing, click coordinates across device/zoom modes, background restoration,
overlapping actions, and cursor hit testing. It does not operate the user's apps.
Source/component verification is not installed-build verification.
