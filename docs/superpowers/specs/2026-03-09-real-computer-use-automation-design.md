# Real Computer Use Automation for Local Desktop + VM

**Date**: 2026-03-09
**Status**: Approved

## Goal

Enable Navi to autonomously control the user's computer (real machine or VM) using Anthropic's Computer Use API — taking screenshots, clicking, typing, scrolling — instead of just giving text instructions.

## Current State

The codebase has a complete VM automation pipeline:
- `ComputerUseAdapter` translates Anthropic `computer_use` actions to VBoxManage CLI commands
- `ComputerUseSession` runs the Anthropic API tool loop (`computer_20250124` beta)
- Agent runner delegates to `ComputerUseSession` when a VM has computer use enabled
- `CoworkDesktopView` provides VNC viewer with "Navi: Active" toggle

What's missing:
- No local desktop automation (host machine screenshots/input)
- The recent onboarding change routes "real-machine" to text-only instructions
- No shared interface between VM adapter and a potential local adapter

## Architecture

### Adapter Abstraction

Extract a `ComputerUseProvider` interface. Shared types (`ComputerUseAction`, `ComputerUseResult`) move to the provider file so both adapters import from the same source.

```typescript
// src/main/vm/computer-use-provider.ts
import type { ComputerUseAction, ComputerUseResult } from './computer-use-provider';

export interface ComputerUseProvider {
  getDisplaySize(): { width: number; height: number };
  execute(action: ComputerUseAction): Promise<ComputerUseResult>;
}
```

Both adapters implement this:
- `ComputerUseAdapter` (VM, VBoxManage) — existing, add `implements ComputerUseProvider`
- `LocalDesktopAdapter` (host machine, nut.js) — new

`ComputerUseSession` accepts `ComputerUseProvider` instead of `ComputerUseAdapter`.

### LocalDesktopAdapter

New file: `src/main/vm/local-desktop-adapter.ts`

Uses `@nut-tree/nut-js` ^4.x for cross-platform desktop control:

| Action | nut.js API |
|--------|-----------|
| `screenshot` | `screen.grab()` → PNG buffer → base64 |
| `click(x,y)` | `mouse.setPosition({x,y})` + `mouse.click(Button.LEFT)` |
| `double_click` | Two `mouse.click()` calls with delay |
| `triple_click` | Three `mouse.click()` calls with delay |
| `type(text)` | `keyboard.type(text)` |
| `key(combo)` | Parse "ctrl+c" → `keyboard.pressKey()`/`releaseKey()` |
| `scroll(x,y,dx,dy)` | `mouse.setPosition()` + `mouse.scrollDown()`/`scrollUp()` |
| `cursor_position` | `mouse.getPosition()` |
| `wait(duration)` | `setTimeout` + screenshot |
| `drag(start,end)` | `mouse.drag()` from start to end |

Display size: detected via `screen.width()` / `screen.height()` at init.
Screenshots: ephemeral only. Saved to `<userData>/desktop-screenshots/`, deleted immediately after base64 encoding. Never persisted to conversation history or sent anywhere besides the Anthropic API.

### Agent Runner Delegation

The existing delegation block (agent-runner.ts lines 1243-1286) is expanded:

```
1. Read workEnvironment from configStore
2. If 'real-machine':
   - Create LocalDesktopAdapter (singleton, reused across turns)
   - Delegate to ComputerUseSession with local adapter
   - Auto-start: every message goes through ComputerUseSession
   - MAX_TOOL_LOOPS reduced to 15 for real-machine (vs 25 for VM)
3. If 'vm':
   - Existing logic: check active VMs with computerUseEnabled
   - Delegate to ComputerUseSession with VBoxManage adapter
   - MAX_TOOL_LOOPS stays at 25
4. If null:
   - Fall through to normal query() path (no automation)
```

### System Prompt

`getVMCoworkPrompt()` in `agent-runner.ts` is renamed to `getWorkspacePrompt()`:

**real-machine mode:**
```
<workspace_mode>
You have computer tool access on the user's real desktop (OS: {platform}).
IMPORTANT: This is the user's real machine. Be careful and deliberate.
Take a screenshot first to see the current state. Then act step by step:
1. Screenshot to observe
2. Click/type/scroll to interact
3. Screenshot to verify
4. Describe what you see and what you're doing
Always narrate your actions. Do NOT type passwords or interact with system settings
unless the user explicitly asks. Avoid destructive actions (closing unsaved work, etc).
</workspace_mode>
```

**vm mode:** Original prompt restored — shows active VMs, computer use status, instructs Navi to use the computer tool.

**null:** Minimal prompt suggesting user complete onboarding.

### Onboarding Modal Update

`OnboardingModal.tsx` changes:
- On mount: call `window.electronAPI.vm.checkBackend()` to detect VirtualBox
- If VirtualBox available: show both "My Computer" and "Virtual Machine" options
- If VirtualBox NOT available: still show modal but only with "My Computer" option (no silent opt-in)
- **Updated description for "My Computer"**: "Navi can see your screen and control your mouse and keyboard to help you with tasks. You can stop Navi at any time."
- **Updated description for "VM"**: "Navi controls a virtual desktop — isolated and safe. Your real machine is never touched."
- For existing users who already have `workEnvironment: 'real-machine'` from the text-only era: on next launch, reset `workEnvironment` to `null` to force re-consent. Detect via a new `workEnvironmentVersion` config field (set to `2` after new onboarding).

### Dependencies

- Add `@nut-tree/nut-js@^4` to `dependencies`
- Add `electron-rebuild` to `devDependencies`
- Add `"postinstall": "electron-rebuild"` to package.json scripts
- Works on Windows, macOS, Linux

## Files Changed

| File | Change |
|------|--------|
| `src/main/vm/computer-use-provider.ts` | **New** — `ComputerUseProvider` interface + shared types (`ComputerUseAction`, `ComputerUseResult`) |
| `src/main/vm/local-desktop-adapter.ts` | **New** — nut.js-based local desktop adapter |
| `src/main/vm/computer-use-adapter.ts` | Add `implements ComputerUseProvider`, import types from provider |
| `src/main/vm/computer-use-session.ts` | Change constructor type `ComputerUseAdapter` → `ComputerUseProvider`, add `maxLoops` option |
| `src/main/claude/agent-runner.ts` | Rename `getVMCoworkPrompt` → `getWorkspacePrompt`, expand delegation for real-machine mode, import `LocalDesktopAdapter` + `configStore` |
| `src/main/config/config-store.ts` | Add `workEnvironmentVersion: number` field (for re-consent detection) |
| `src/renderer/components/OnboardingModal.tsx` | Add VirtualBox auto-detection, update descriptions, handle re-consent |
| `package.json` | Add `@nut-tree/nut-js@^4`, `electron-rebuild` to devDeps, `postinstall` script |

## Error Handling

- If nut.js fails to capture screen (e.g. permissions), return error result — session continues with text
- If adapter init fails, fall through to normal query() with a warning in system prompt
- macOS requires Accessibility permissions — detect and prompt via system dialog
- Windows may need DPI awareness for correct coordinates — nut.js handles this via its `screen` module

## Security Considerations

- **Consent model**: Onboarding modal explicitly describes desktop control. Users who had "real-machine" under the old text-only semantics are forced to re-consent via `workEnvironmentVersion`.
- **Guardrails in system prompt**: Navi is instructed not to type passwords, interact with system settings, or perform destructive actions unless explicitly asked.
- **Reduced loop limit**: 15 actions max for real-machine (vs 25 for VM) to limit unattended automation scope.
- **Action logging**: All computer use actions are logged via the existing `log()` system.
- **AbortController**: User can cancel at any time; `cuSession.abort()` stops the loop.
- **Screenshot privacy**: Screenshots are ephemeral — deleted after base64 encoding, never persisted to disk or conversation history. Only sent to Anthropic API for the current tool loop.
- **No action allow-list needed**: Unlike VM guest execution (which has `ALLOWED_COMMANDS`), nut.js only exposes mouse/keyboard/screen — it cannot execute shell commands, access files, or modify system state. The risk surface is the same as a human using mouse and keyboard.
