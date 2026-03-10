# Seamless VM Integration Design

**Date:** 2026-03-10
**Status:** Approved
**Target:** VirtualBox 6.1+ (minimum). VirtualBox 7.x recommended.
**Goal:** Make VirtualBox invisible. VMs launch headless, render inside the Electron app via noVNC, and users interact exclusively through Navi. Eliminate technical overhead and frustration.

---

## Problem Statement

1. VMs launch with the raw VirtualBox GUI window visible — too technical, breaks the product experience.
2. The OS shows a black screen (wrong graphics controller/VRAM settings for custom ISOs like Zorin).
3. Two parallel start paths (`startVM` with GUI vs `startWithVNC` headless) cause confusion.
4. No visual feedback when Navi is working on the VM.
5. Long agent tasks block the user with no escape.

## Design Principles

- **VirtualBox is invisible.** Users never see it unless they explicitly look for an escape hatch.
- **View-only by default.** The VM never captures the user's cursor or keyboard unless they ask Navi.
- **Navi is the operator.** Users direct; Navi executes on the VM.
- **Non-blocking.** Users can navigate away during long tasks and get notified on completion.
- **One-click stop.** Any agent work can be cancelled instantly and non-destructively.

---

## Architecture Changes

### 1. Eliminate GUI Start Path

**All user-initiated VM starts use `startWithVNC`.** The `vm.startVM` IPC handler is deprecated from renderer use — it remains for internal/programmatic headless launches only (no UI button calls it).

- `VMView.tsx` "Start" button calls `vm.startWithVNC` instead of `vm.startVM`.
- On success, automatically navigates to `CoworkDesktopView` with the returned `wsUrl`.
- `vm-manager.ts` `startVM()` always passes `gui=false` regardless of `displayMode` — no VBox GUI ever launched by the app. This method is kept for non-display server VMs but is never exposed to a user-facing button.
- Default `displayMode` for new VMs changes from `'separate_window'` to `'embedded'`.

**Reconnecting to already-running VMs (app restart):**

A new `reconnectVNC(vmId)` method on `VMManager` handles the case where the app restarts while a VM is already running with VRDE enabled:
1. Detect VM is in `running` state via `getVMStatus()`.
2. Query the existing VRDE port from `VBoxManage showvminfo <name> --machinereadable` (field: `vrdeport`).
3. Skip VRDE enable (already on) and VM start (already running).
4. Allocate the WebSocket proxy against the discovered VRDE port.
5. Start health monitor + screenshot polling as normal.

On app launch, `VMManager.initialize()` scans all known VMs — if any are running, it calls `reconnectVNC()` automatically.

- New IPC: `vm.reconnectVNC(vmId)` for manual reconnect.
- Integrated into startup flow in `VMManager.initialize()`.

**VRDE Extension Pack check:**

Before first `startWithVNC`, a new `checkVRDE()` method on `VirtualBoxBackend` runs `VBoxManage list extpacks` to verify the Extension Pack is installed. If missing, show a prompt similar to the existing "VirtualBox Not Found" screen but for the Extension Pack, with a download link.

- New IPC: `vm.checkVRDE` → returns `{ installed: boolean; error?: string }`
- New UI: `VRDENotFound` prompt component in VMView (modeled on the existing `vmBackendStatus.available === false` screen).

### 2. View-Only by Default, Navi-Gated Input

The embedded VM desktop **never captures user input** unless explicitly requested.

**Default state:**
- `VMDesktopViewer` renders with `viewOnly={true}` always.
- User sees a live video feed of the VM. Mouse and keyboard stay with Coeadapt.
- The manual "Interactive/View Only" toggle is removed from the control bar.

**Interactive mode (rare, explicit):**
- User asks Navi: "let me type in the VM" (e.g., for password entry during OS install).
- Navi calls a new `enable_user_input` tool action, which sets `interactiveMode=true` in the app store.
- A yellow banner appears: **"You have keyboard control — press Esc to release"**
- Pressing `Esc` or clicking outside the VM canvas immediately returns to view-only.
- Interactive mode auto-disables after 3 minutes of no input (safety net — long enough for OS install pauses).

**`enable_user_input` tool registration:**
- Defined as a custom tool in the `ComputerUseSession` tools array alongside the `computer` tool:
  ```json
  { "type": "custom", "name": "enable_user_input", "description": "Temporarily grant the user direct keyboard/mouse access to the VM. Call this when the user needs to type sensitive input (passwords, 2FA codes) or when they explicitly ask to interact with the VM directly." }
  ```
- When the model returns a `tool_use` block for `enable_user_input`, the session emits a new `vm.interactiveMode` ServerEvent: `{ type: 'vm.interactiveMode', payload: { vmId, enabled: true } }`.
- The renderer's IPC/event listener (in `useIPC` hook) updates the Zustand store field `interactiveMode` (keyed per VM, see Store State section below).
- When the user presses Esc, the renderer sends `vm.disableInteractiveMode(vmId)` IPC, which emits the reverse event.

**Navi is the primary VM operator:**
- Users direct Navi via chat: "open Firefox", "install VS Code", etc.
- Navi uses Computer Use (screenshots + VBoxManage clicks/keyboard) to execute.
- The user watches the live noVNC feed as Navi works.

### 3. Blue Activity Haze (Antigravity-style)

When Navi is actively executing Computer Use actions, a visual overlay signals agent activity.

**Visual design:**
- Semi-transparent blue haze overlay on the VM canvas using inline styles (`background: rgba(59, 130, 246, 0.15)`) — NOT Tailwind opacity modifier syntax which doesn't work with CSS variable colors in this project.
- Breathing CSS animation via a `@keyframes navi-haze` rule: opacity pulses between 10%-20% over 2s.
- Subtle blue glow on the border of the VM viewer (`box-shadow: 0 0 20px rgba(59, 130, 246, 0.3)`).
- The VM display remains visible underneath — the user can see what Navi is doing.

**Status pill (top-center of VM viewer):**
- Pill with: blue pulse dot + "Navi is working..." text + **red Stop button**.
- Stop button: prominent, always one click away.

**State transitions:**
- `isAgentWorking=false` → no overlay, no pill.
- `isAgentWorking=true` → blue haze fades in (300ms), pill appears.
- On stop/complete → haze fades out (300ms), pill disappears.

**Implementation:**
- New store state — see "Store State" section below for per-VM keyed state.
- `VMDesktopViewer` renders the overlay layer conditionally.
- The status pill is a child component of `VMDesktopViewer`, positioned absolutely at top-center.

### 4. Non-Blocking Long Tasks

Users should never be stuck watching the VM during complex setups.

**Navigate away freely:**
- The VM view is not modal. User can switch to chat, career tools, settings, any view.
- When navigated away, a **blue dot indicator** appears next to "Desktop" in the sidebar/nav: tooltip shows "Navi is working on [VM name]..."
- The VM and Navi session continue running in the background.

**Notifications on completion/error:**
- When Navi finishes a task: in-app toast notification — "Navi finished: [task summary]"
- When Navi hits an error or needs input: toast + visual indicator — "Navi needs your help on [VM name]"
- Optional: system notification (Electron `Notification` API) for when the app is minimized.

**Chat as live log (reuses existing trace infrastructure):**
- The existing `ComputerUseSession` already emits `trace.step` and `stream.partial` events to the renderer while working. These appear in the chat panel as a live action log ("Computer Use: screenshot", "Computer Use: click", etc.).
- No new streaming mechanism needed — the existing trace infrastructure is sufficient.
- User can review progress at any time without watching the VM.
- Chat panel is accessible from any view via the existing split-pane layout.

**Session persistence:**
- If user closes the app, `shutdownAll()` gracefully stops Navi's session and screenshot polling timers.
- VM stays running. On next launch, `VMManager.initialize()` detects running VMs and calls `reconnectVNC()` to re-establish the WebSocket proxy (see Section 1).

### 5. Stop Behavior

**One-click cancellation, non-destructive.**

When the user clicks Stop (in the VM viewer pill or via chat):
1. `ComputerUseSession` sets a cancellation flag, checked between each iteration of the tool loop.
2. The current API call is allowed to finish (no abort mid-request), but no further tool calls are made.
3. Blue haze fades out.
4. Navi sends a chat message: "Stopped. The VM is still running — let me know when you'd like to continue."
5. VM stays running in view-only mode. No work is lost.

**New IPC:** `vm.cancelComputerUse(vmId)` → calls `abort()` on the active session.

**Reuses existing method:** `ComputerUseSession.abort()` already exists — sets `this.aborted = true`, checked on line 80 of the main loop before each `client.messages.create()` call. No new cancellation method needed. The IPC handler simply calls `session.abort()` and emits a `session.status` event with status `'cancelled'` so the renderer can clear the blue haze and show the "Stopped" chat message.

### 6. VM Screenshot Thumbnails

Show a preview of the VM's current state in the VM management view.

**How it works:**
- `VMManager.startScreenshotPolling(vmId)` starts an interval (every 30s) that calls `VBoxManage controlvm <name> screenshotpng <tmpFile>`, reads it as base64, and stores it in a `Map<string, string>`.
- Polling interval: 30 seconds (not 10s — reduces I/O overhead; thumbnails are for glanceable state, not live video).
- Polling only runs when the VM management view is active OR when the user is navigated away (for the sidebar thumbnail). Stopped when the CoworkDesktopView is active (noVNC provides the live view).
- Screenshots are captured at reduced resolution — VBoxManage produces the full framebuffer, but we resize to 400px wide before base64 encoding to reduce memory.
- Polling starts when `startWithVNC` succeeds, stops when VM stops.
- Screenshot polling timers are cleaned up in `shutdownAll()` alongside health monitors.
- New IPC: `vm.getLatestScreenshot(vmId)` → returns `string | null` (base64 PNG).

**Where thumbnails appear:**
- `VMCard` in VMView: small ~200px thumbnail when VM state is `running`.
- `CoworkDesktopPlaceholder`: larger preview showing last state before user opens the desktop view.

### 7. Hidden "Open in VirtualBox" Escape Hatch

For power users who know VirtualBox.

**Location:** In a `...` overflow menu on each VM card in VMView. At the bottom of the menu, with muted text styling: **"Advanced: Open in VirtualBox"**.

**Behavior:** Calls the existing `openDisplay` IPC which runs `VBoxManage startvm --type separate` to attach a VirtualBox GUI window to the running headless VM.

**Not shown:** In CoworkDesktopView, the control bar, or any prominent location. Users must be on the VM management page and open the overflow menu to find it.

### 8. Fix Black Screen (Graphics Config)

**Default graphics improvements for all new VMs:**

In `VirtualBoxBackend.createVM()`:
- Change `--graphicscontroller vmsvga` to `--graphicscontroller VBoxSVGA` (better compatibility with Linux desktop distros in EFI mode). Note: VBoxSVGA requires VirtualBox 6.1+, which is the minimum target for this project.
- Keep default VRAM at 128MB (the VirtualBox maximum on some versions). 128MB is sufficient for VBoxSVGA at 1024x768. Users can increase to 256MB on VBox 7.x via the Modify VM dialog.
- Add `--accelerate3d off` (prevents driver issues in fresh installs).

**Custom ISO import improvements:**

In the import dialog, add an optional OS family dropdown:
- Ubuntu/Debian-based → `vboxOsType: 'Ubuntu_64'`
- Fedora/RHEL-based → `vboxOsType: 'Fedora_64'`
- Arch-based → `vboxOsType: 'ArchLinux_64'`
- Windows → `vboxOsType: 'Windows11_64'`
- Other Linux → `vboxOsType: 'Linux_64'` (default)

`VMImageRegistry.importISO()` accepts an optional `osFamily` parameter that maps to the appropriate `vboxOsType`.

---

## Store State (Zustand)

All new VM-related state is **per-VM**, keyed by `vmId`. This supports multiple VMs running simultaneously.

```typescript
// New fields in the app Zustand store:
naviAgentWorkingVMs: Set<string>;        // vmIds where Navi is actively working
interactiveModeVMs: Set<string>;         // vmIds with user interactive mode enabled
latestVMScreenshots: Map<string, string>; // vmId → base64 PNG thumbnail
```

Convenience selectors:
- `isNaviWorking(vmId)` → `naviAgentWorkingVMs.has(vmId)`
- `isNaviWorkingAnywhere()` → `naviAgentWorkingVMs.size > 0` (for sidebar indicator)
- `isInteractive(vmId)` → `interactiveModeVMs.has(vmId)`

These are updated by ServerEvent listeners in the `useIPC` hook:
- `session.status` with `status: 'running'` → add to `naviAgentWorkingVMs`
- `session.status` with `status: 'idle' | 'error' | 'cancelled'` → remove from `naviAgentWorkingVMs`
- `vm.interactiveMode` → add/remove from `interactiveModeVMs`
- `vm.screenshot` → update `latestVMScreenshots`

---

## Files Changed

| File | Change |
|------|--------|
| `src/main/vm/backends/virtualbox-backend.ts` | Add `checkVRDE()`, add `getVRDEPort(vmName)`, graphics → VBoxSVGA, VRAM 128, 3D off |
| `src/main/vm/vm-manager.ts` | Force `gui=false` in `startVM()`, add `reconnectVNC()`, add screenshot polling (+ cleanup in `shutdownAll`), add `checkVRDE()` proxy |
| `src/main/vm/computer-use-session.ts` | Add `enable_user_input` custom tool to tools array, emit `vm.interactiveMode` event on tool call, emit `session.status: 'cancelled'` on abort |
| `src/main/ipc/vm.handlers.ts` | Add `vm.checkVRDE`, `vm.reconnectVNC`, `vm.getLatestScreenshot`, `vm.cancelComputerUse`, `vm.disableInteractiveMode` handlers |
| `src/renderer/components/VMDesktopViewer.tsx` | Always view-only by default, add blue haze overlay (inline rgba styles), status pill + stop button, Esc handler for interactive mode, yellow interactive banner, remove "View only" indicator from toolbar (replaced by always-on behavior) |
| `src/renderer/components/CoworkDesktopView.tsx` | Remove manual view-only toggle, wire per-VM `isAgentWorking` + `interactiveMode` from store, handle stop via IPC |
| `src/renderer/components/VMView.tsx` | Start → `startWithVNC` + navigate, add thumbnail to VMCard, add `...` overflow menu with hidden VBox option, add VRDE check prompt |
| `src/renderer/components/VMCreateWizard.tsx` | Default displayMode → `'embedded'`, OS family dropdown for custom imports |
| `src/main/vm/vm-image-registry.ts` | `importISO()` accepts optional `osFamily` param |
| App store (Zustand) | Add per-VM `naviAgentWorkingVMs`, `interactiveModeVMs`, `latestVMScreenshots` (see Store State section) |
| `useIPC` hook | Handle new events: `vm.interactiveMode`, `vm.screenshot`, `session.status: 'cancelled'` |
| Sidebar/nav component | Blue dot indicator when `isNaviWorkingAnywhere()` is true and user is on another view |
| Notification system | Toast on Navi completion/error during background work |
| Preload + type declarations | New IPC methods wired through preload bridge |

## Test Diagram

| # | Scenario | Type | Covers |
|---|----------|------|--------|
| 1 | VMView "Start" always launches headless with VNC | integration | No VBox GUI from Start button |
| 2 | VMView navigates to CoworkDesktopView after start | integration | Seamless flow |
| 3 | VM viewer is view-only by default | unit | No input capture without request |
| 4 | Esc exits interactive mode | unit | Users never get trapped |
| 5 | Interactive mode auto-disables after 3min idle | unit | Safety net |
| 6 | Blue haze appears when Navi is working | integration | Visual feedback |
| 7 | Blue haze fades out on stop/complete | integration | Clean transitions |
| 8 | Stop button cancels ComputerUseSession | integration | One-click cancel works |
| 9 | User navigates away, blue dot appears in sidebar | integration | Non-blocking indicator |
| 10 | Toast notification on Navi completion | integration | Background task notification |
| 11 | `startWithVNC` failure rolls back VRDE + port | unit | Clean error handling |
| 12 | VM already running → reconnect VNC session | integration | Re-attach without error |
| 13 | VRDE not installed → clear prompt shown | unit | Graceful degradation |
| 14 | Screenshot polling produces thumbnails | unit | Thumbnails work |
| 15 | VMCard shows thumbnail for running VM | integration | Visual preview |
| 16 | "Advanced: Open in VirtualBox" in overflow menu | integration | Escape hatch works |
| 17 | New VMs use VBoxSVGA + 128MB VRAM + 3D off | unit | Black screen fix |
| 18 | Custom ISO import with OS family sets correct osType | unit | Import defaults |
| 19 | Health monitor auto-cleans up on external power-off | integration | Orphan prevention |
| 20 | App shutdown gracefully stops all sessions + screenshot timers | integration | Clean exit |
| 21 | App restart reconnects VNC to already-running VM | integration | Session persistence |
| 22 | `enable_user_input` tool call triggers interactive mode in renderer | integration | Navi-gated input |
| 23 | Per-VM store state: two VMs can have independent agent/interactive state | unit | Multi-VM support |
| 24 | Blue haze uses inline rgba styles (not Tailwind opacity modifiers) | unit | CSS compatibility |
| 25 | Screenshot polling cleaned up in `shutdownAll()` | unit | No timer leaks |
