# Seamless VM Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make VirtualBox invisible — VMs always launch headless with embedded noVNC display, view-only by default, blue activity haze when Navi works, non-blocking long tasks, and one-click stop.

**Architecture:** VirtualBox runs as a headless engine. VRDE exports the framebuffer over VNC, a WebSocket proxy bridges it to noVNC in the renderer. All user-facing buttons use `startWithVNC` (never `--type gui`). Navi interacts with the VM via Computer Use; users watch. Interactive mode is gated behind an explicit Navi tool call.

**Tech Stack:** Electron + Vite + React, VBoxManage CLI, `react-vnc` (noVNC), Zustand store, `ws` WebSocket proxy, Anthropic Computer Use API, Vitest.

**Spec:** `docs/superpowers/specs/2026-03-10-seamless-vm-integration-design.md`

---

## File Structure

### Files to Modify
| File | Responsibility |
|------|---------------|
| `src/main/vm/backends/virtualbox-backend.ts` | VBoxManage wrapper — add `checkVRDE()`, `getVRDEPort()`, change graphics defaults |
| `src/main/vm/vm-manager.ts` | VM orchestrator — add `reconnectVNC()`, screenshot polling, force headless |
| `src/main/vm/computer-use-session.ts` | Anthropic tool loop — add `enable_user_input` tool, accept `vmId` in options, emit `vm.interactiveMode` event |
| `src/main/ipc/vm.handlers.ts` | IPC bridge — add new handlers |
| `src/preload/index.ts` | Preload API — expose new IPC methods |
| `src/renderer/types/index.ts` | Type defs — add new ServerEvent variants |
| `src/renderer/store/index.ts` | Zustand — add per-VM agent/interactive/screenshot state |
| `src/renderer/hooks/useIPC.ts` | Event listener — handle new events |
| `src/renderer/components/VMDesktopViewer.tsx` | noVNC viewer — add haze overlay, status pill, interactive banner |
| `src/renderer/components/CoworkDesktopView.tsx` | Split-pane — remove view-only toggle, wire store state |
| `src/renderer/components/VMView.tsx` | VM management — startWithVNC, thumbnails, overflow menu |
| `src/renderer/components/VMCreateWizard.tsx` | Create wizard — default embedded, OS family dropdown |
| `src/renderer/components/Sidebar.tsx` | Nav sidebar — add blue Navi-working dot |
| `src/main/vm/vm-image-registry.ts` | Image registry — accept `osFamily` on import |

### Files to Create
| File | Responsibility |
|------|---------------|
| `tests/vm-backend-vrde.test.ts` | Tests for checkVRDE, getVRDEPort, graphics defaults |
| `tests/vm-manager-reconnect.test.ts` | Tests for reconnectVNC, screenshot polling |
| `tests/vm-store-state.test.ts` | Tests for per-VM Zustand state |

---

## Chunk 1: Backend Fixes (Graphics + VRDE Check)

### Task 1: Fix Graphics Controller Defaults

**Files:**
- Modify: `src/main/vm/backends/virtualbox-backend.ts:164-179`
- Create: `tests/vm-backend-vrde.test.ts`

- [ ] **Step 1: Write test for graphics defaults**

```typescript
// tests/vm-backend-vrde.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process.execFile
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

// Mock electron app
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
}));

import { execFile } from 'child_process';

describe('VirtualBoxBackend graphics defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules(); // Reset module cache so each test gets fresh imports
  });

  it('should use VBoxSVGA graphics controller in createVM', async () => {
    // The modifyvm call should contain --graphicscontroller VBoxSVGA
    const mockExecFile = vi.mocked(execFile);
    const calls: string[][] = [];
    mockExecFile.mockImplementation((_cmd: any, args: any, _opts: any, cb: any) => {
      calls.push(args as string[]);
      if (cb) cb(null, '', '');
      return {} as any;
    });

    const { VirtualBoxBackend } = await import('../src/main/vm/backends/virtualbox-backend');
    const backend = new VirtualBoxBackend();
    // Set the path directly for testing
    (backend as any).vboxManagePath = '/usr/bin/VBoxManage';

    await backend.createVM(
      { id: '1', name: 'test-vm', osImageId: 'test', resources: { cpuCount: 2, memoryMb: 4096, diskSizeGb: 25, displayMode: 'embedded' }, createdAt: '', updatedAt: '', backendType: 'virtualbox' },
      '/tmp/test.iso',
    );

    // Find the modifyvm call (step 2)
    const modifyCall = calls.find(args => args[0] === 'modifyvm' && args.includes('--graphicscontroller'));
    expect(modifyCall).toBeDefined();
    expect(modifyCall).toContain('VBoxSVGA');
    expect(modifyCall).not.toContain('vmsvga');
  });

  it('should disable 3D acceleration in createVM', async () => {
    const mockExecFile = vi.mocked(execFile);
    const calls: string[][] = [];
    mockExecFile.mockImplementation((_cmd: any, args: any, _opts: any, cb: any) => {
      calls.push(args as string[]);
      if (cb) cb(null, '', '');
      return {} as any;
    });

    const { VirtualBoxBackend } = await import('../src/main/vm/backends/virtualbox-backend');
    const backend = new VirtualBoxBackend();
    (backend as any).vboxManagePath = '/usr/bin/VBoxManage';

    await backend.createVM(
      { id: '1', name: 'test-vm', osImageId: 'test', resources: { cpuCount: 2, memoryMb: 4096, diskSizeGb: 25, displayMode: 'embedded' }, createdAt: '', updatedAt: '', backendType: 'virtualbox' },
      '/tmp/test.iso',
    );

    const modifyCall = calls.find(args => args[0] === 'modifyvm' && args.includes('--accelerate3d'));
    expect(modifyCall).toBeDefined();
    expect(modifyCall).toContain('off');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/vm-backend-vrde.test.ts`
Expected: FAIL — current code uses `vmsvga` and doesn't have `--accelerate3d`

- [ ] **Step 3: Change graphics controller to VBoxSVGA and add 3D off**

In `src/main/vm/backends/virtualbox-backend.ts`, modify the `modifyArgs` in `createVM()`:

```typescript
      const modifyArgs = [
        'modifyvm', vmName,
        '--cpus', String(cpuCount),
        '--memory', String(memoryMb),
        '--vram', String(vramMb),
        '--graphicscontroller', 'VBoxSVGA',
        '--accelerate3d', 'off',
        '--nic1', 'nat',
        '--audio-driver', 'default',
        '--clipboard-mode', 'bidirectional',
        '--draganddrop', 'bidirectional',
      ];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/vm-backend-vrde.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/vm/backends/virtualbox-backend.ts tests/vm-backend-vrde.test.ts
git commit -m "fix: use VBoxSVGA graphics controller and disable 3D acceleration"
```

### Task 2: Add VRDE Extension Pack Check

**Files:**
- Modify: `src/main/vm/backends/virtualbox-backend.ts`
- Modify: `tests/vm-backend-vrde.test.ts`

- [ ] **Step 1: Write test for checkVRDE**

Append to `tests/vm-backend-vrde.test.ts`:

```typescript
describe('VirtualBoxBackend VRDE check', () => {
  it('should return installed:true when Extension Pack is listed', async () => {
    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation((_cmd: any, args: any, _opts: any, cb: any) => {
      if ((args as string[]).includes('list') && (args as string[]).includes('extpacks')) {
        cb(null, 'Extension Packs: 1\nPack no. 0:   Oracle VM VirtualBox Extension Pack\nVersion:      7.1.4\nEnabled:      true\n', '');
      } else {
        cb(null, '', '');
      }
      return {} as any;
    });

    const { VirtualBoxBackend } = await import('../src/main/vm/backends/virtualbox-backend');
    const backend = new VirtualBoxBackend();
    (backend as any).vboxManagePath = '/usr/bin/VBoxManage';

    const result = await backend.checkVRDE();
    expect(result.installed).toBe(true);
  });

  it('should return installed:false when no Extension Pack', async () => {
    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation((_cmd: any, args: any, _opts: any, cb: any) => {
      if ((args as string[]).includes('list') && (args as string[]).includes('extpacks')) {
        cb(null, 'Extension Packs: 0\n', '');
      } else {
        cb(null, '', '');
      }
      return {} as any;
    });

    const { VirtualBoxBackend } = await import('../src/main/vm/backends/virtualbox-backend');
    const backend = new VirtualBoxBackend();
    (backend as any).vboxManagePath = '/usr/bin/VBoxManage';

    const result = await backend.checkVRDE();
    expect(result.installed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/vm-backend-vrde.test.ts`
Expected: FAIL — `checkVRDE` method doesn't exist

- [ ] **Step 3: Implement checkVRDE**

Add to `VirtualBoxBackend` class in `virtualbox-backend.ts`:

```typescript
  async checkVRDE(): Promise<{ installed: boolean; error?: string }> {
    try {
      const { stdout } = await this.vbox('list', 'extpacks');
      // Look for "Extension Packs: 0" which means none installed
      const match = stdout.match(/Extension Packs:\s*(\d+)/);
      const count = match ? parseInt(match[1], 10) : 0;
      if (count > 0) {
        log('[VBox] VRDE Extension Pack found');
        return { installed: true };
      }
      return { installed: false, error: 'VirtualBox Extension Pack is not installed. It is required for embedded VM display.' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { installed: false, error: msg };
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/vm-backend-vrde.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/vm/backends/virtualbox-backend.ts tests/vm-backend-vrde.test.ts
git commit -m "feat: add VRDE Extension Pack check to VirtualBox backend"
```

### Task 3: Add getVRDEPort for Reconnect Support

**Files:**
- Modify: `src/main/vm/backends/virtualbox-backend.ts`
- Modify: `tests/vm-backend-vrde.test.ts`

- [ ] **Step 1: Write test for getVRDEPort**

Append to `tests/vm-backend-vrde.test.ts`:

```typescript
describe('VirtualBoxBackend getVRDEPort', () => {
  it('should return the VRDE port from showvminfo', async () => {
    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation((_cmd: any, args: any, _opts: any, cb: any) => {
      if ((args as string[]).includes('showvminfo')) {
        cb(null, 'vrde="on"\nvrdeport=5905\nvrdeaddress="127.0.0.1"\n', '');
      } else {
        cb(null, '', '');
      }
      return {} as any;
    });

    const { VirtualBoxBackend } = await import('../src/main/vm/backends/virtualbox-backend');
    const backend = new VirtualBoxBackend();
    (backend as any).vboxManagePath = '/usr/bin/VBoxManage';

    const port = await backend.getVRDEPort('test-vm');
    expect(port).toBe(5905);
  });

  it('should return null when VRDE is off', async () => {
    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation((_cmd: any, args: any, _opts: any, cb: any) => {
      if ((args as string[]).includes('showvminfo')) {
        cb(null, 'vrde="off"\nvrdeport=-1\n', '');
      } else {
        cb(null, '', '');
      }
      return {} as any;
    });

    const { VirtualBoxBackend } = await import('../src/main/vm/backends/virtualbox-backend');
    const backend = new VirtualBoxBackend();
    (backend as any).vboxManagePath = '/usr/bin/VBoxManage';

    const port = await backend.getVRDEPort('test-vm');
    expect(port).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/vm-backend-vrde.test.ts`
Expected: FAIL — `getVRDEPort` method doesn't exist

- [ ] **Step 3: Implement getVRDEPort**

Add to `VirtualBoxBackend` class:

```typescript
  async getVRDEPort(vmId: string): Promise<number | null> {
    try {
      const { stdout } = await this.vbox('showvminfo', vmId, '--machinereadable');
      const info = parseMachineReadable(stdout);
      if (info['vrde'] !== 'on') return null;
      const port = parseInt(info['vrdeport'], 10);
      return isNaN(port) || port <= 0 ? null : port;
    } catch {
      return null;
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/vm-backend-vrde.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/vm/backends/virtualbox-backend.ts tests/vm-backend-vrde.test.ts
git commit -m "feat: add getVRDEPort method for VNC reconnect support"
```

### Task 4: Force startVM to Always Use Headless

**Files:**
- Modify: `src/main/vm/vm-manager.ts:144-151`

- [ ] **Step 1: Change startVM to always pass gui=false**

In `vm-manager.ts`, change `startVM`:

```typescript
  async startVM(vmId: string): Promise<VMOperationResult> {
    if (!this.backend) return { success: false, error: 'VM backend not available' };
    const config = vmConfigStore.getVM(vmId);
    if (!config) return { success: false, error: 'VM not found' };

    // Always headless — the app never opens VirtualBox GUI
    return this.backend.startVM(config.name, false);
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/main/vm/vm-manager.ts
git commit -m "fix: force startVM to always use headless mode"
```

---

## Chunk 2: VNC Reconnect + Screenshot Polling

### Task 5: Add reconnectVNC to VMManager

**Files:**
- Modify: `src/main/vm/vm-manager.ts`
- Create: `tests/vm-manager-reconnect.test.ts`

- [ ] **Step 1: Write test for reconnectVNC**

```typescript
// tests/vm-manager-reconnect.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
}));

describe('VMManager reconnectVNC', () => {
  it('should reconnect to a running VM with existing VRDE port', async () => {
    // This is a high-level integration test — we verify the method exists
    // and returns a wsUrl when the VM is running with VRDE enabled
    const { VMManager } = await import('../src/main/vm/vm-manager');
    const manager = new VMManager();

    // reconnectVNC should exist as a method
    expect(typeof (manager as any).reconnectVNC).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/vm-manager-reconnect.test.ts`
Expected: FAIL — `reconnectVNC` doesn't exist

- [ ] **Step 3: Implement reconnectVNC**

Add to `VMManager` class in `vm-manager.ts`:

```typescript
  /** Reconnect VNC to an already-running VM (e.g., after app restart) */
  async reconnectVNC(vmId: string): Promise<VMOperationResult & { wsUrl?: string }> {
    if (!this.backend || !this.vboxBackend) {
      return { success: false, error: 'VM backend not available' };
    }

    const config = vmConfigStore.getVM(vmId);
    if (!config) return { success: false, error: 'VM not found' };

    try {
      // 1. Verify VM is actually running
      const status = await this.backend.getVMStatus(config.name);
      if (status.state !== 'running') {
        return { success: false, error: `VM is not running (state: ${status.state})` };
      }

      // 2. Get existing VRDE port
      const vrdePort = await this.vboxBackend.getVRDEPort(config.name);
      if (!vrdePort) {
        return { success: false, error: 'VM is running but VRDE is not enabled' };
      }

      // 3. Skip if already connected
      const existingProxy = this.vncProxies.get(vmId);
      if (existingProxy?.isRunning()) {
        return { success: true, wsUrl: existingProxy.getWebSocketUrl() };
      }

      // 4. Start WebSocket proxy against discovered VRDE port
      const proxy = new VNCWebSocketProxy(vrdePort);
      await proxy.start();
      this.vncProxies.set(vmId, proxy);
      const wsUrl = proxy.getWebSocketUrl();

      // 5. Start health monitor
      this.startHealthMonitor(vmId, config.name);
      this.lastKnownStates.set(vmId, 'running');

      // 6. Emit state change event
      this.emitEvent({
        type: 'vm.stateChanged',
        payload: { vmId, state: 'running', wsUrl },
      });

      log('[VMManager] Reconnected VNC to running VM:', config.name, 'wsUrl:', wsUrl);
      return { success: true, wsUrl };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('[VMManager] reconnectVNC failed:', msg);
      return { success: false, error: msg };
    }
  }
```

- [ ] **Step 4: Auto-reconnect running VMs on initialize**

At the end of `VMManager.initialize()`, after the backend is set up, add:

```typescript
    // Auto-reconnect to any running VMs (app restart scenario)
    if (status.available) {
      const configs = vmConfigStore.getVMs();
      for (const config of configs) {
        try {
          const vmStatus = await vbox.getVMStatus(config.name);
          if (vmStatus.state === 'running') {
            log('[VMManager] Found running VM on startup, reconnecting:', config.name);
            await this.reconnectVNC(config.id);
          }
        } catch {
          // Best effort — don't block startup
        }
      }
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/vm-manager-reconnect.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/vm/vm-manager.ts tests/vm-manager-reconnect.test.ts
git commit -m "feat: add VNC reconnect for app restart and running VM detection"
```

### Task 6: Add Screenshot Polling + Session Tracking

**Files:**
- Modify: `src/main/vm/vm-manager.ts`

- [ ] **Step 0: Add active ComputerUseSession tracking**

Add to `VMManager` class (needed for the cancel IPC handler to call `session.abort()`):

```typescript
  // Active Computer Use sessions (for cancellation support)
  private activeComputerUseSessions: Map<string, ComputerUseSession> = new Map();

  /** Register an active ComputerUseSession for a VM (called by agent-runner) */
  setActiveComputerUseSession(vmId: string, session: ComputerUseSession | null): void {
    if (session) {
      this.activeComputerUseSessions.set(vmId, session);
    } else {
      this.activeComputerUseSessions.delete(vmId);
    }
  }

  /** Get the active session for cancellation */
  getActiveComputerUseSession(vmId: string): ComputerUseSession | null {
    return this.activeComputerUseSessions.get(vmId) ?? null;
  }
```

Add the import at the top of `vm-manager.ts`:

```typescript
import { ComputerUseSession } from './computer-use-session';
```

The agent-runner (`src/main/claude/agent-runner.ts`) must call `vmManager.setActiveComputerUseSession(vmId, session)` when creating a session and `vmManager.setActiveComputerUseSession(vmId, null)` when it completes.

- [ ] **Step 1: Add screenshot polling infrastructure**

Add to `VMManager` class:

```typescript
  // Screenshot polling
  private screenshotTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private latestScreenshots: Map<string, string> = new Map(); // vmId → base64 PNG

  /** Start periodic screenshot capture for thumbnails */
  startScreenshotPolling(vmId: string): void {
    this.stopScreenshotPolling(vmId);

    const config = vmConfigStore.getVM(vmId);
    if (!config || !this.vboxBackend) return;

    const timer = setInterval(async () => {
      try {
        const tmpDir = require('os').tmpdir();
        const tmpPath = require('path').join(tmpDir, `coeadapt-screenshot-${vmId}.png`);
        const result = await this.vboxBackend!.screenshotVM(config.name, tmpPath);
        if (result.success) {
          const fs = require('fs');
          if (fs.existsSync(tmpPath)) {
            const buffer = fs.readFileSync(tmpPath);
            const base64 = buffer.toString('base64');
            this.latestScreenshots.set(vmId, base64);
            this.emitEvent({
              type: 'vm.screenshot' as any,
              payload: { vmId, base64 },
            });
            // Clean up temp file
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
          }
        }
      } catch {
        // Ignore transient screenshot errors
      }
    }, 30000); // Every 30 seconds

    this.screenshotTimers.set(vmId, timer);
  }

  stopScreenshotPolling(vmId: string): void {
    const timer = this.screenshotTimers.get(vmId);
    if (timer) {
      clearInterval(timer);
      this.screenshotTimers.delete(vmId);
    }
  }

  getLatestScreenshot(vmId: string): string | null {
    return this.latestScreenshots.get(vmId) ?? null;
  }
```

- [ ] **Step 2: Wire screenshot polling into startWithVNC and stopWithVNC**

In `startWithVNC`, after `this.startHealthMonitor(vmId, config.name)` add:

```typescript
      this.startScreenshotPolling(vmId);
```

In `stopWithVNC`, after `this.stopHealthMonitor(vmId)` add:

```typescript
      this.stopScreenshotPolling(vmId);
```

In `reconnectVNC`, after `this.startHealthMonitor(vmId, config.name)` add:

```typescript
      this.startScreenshotPolling(vmId);
```

- [ ] **Step 3: Clean up screenshot timers in shutdownAll**

In `shutdownAll()`, after stopping health monitors add:

```typescript
    // Stop all screenshot polling
    for (const vmId of this.screenshotTimers.keys()) {
      this.stopScreenshotPolling(vmId);
    }
```

- [ ] **Step 4: Clean up screenshot polling in auto-cleanup (health monitor)**

In the health monitor's auto-cleanup block (inside the `if (status.state === 'powered_off' || status.state === 'error')` block), add:

```typescript
              this.stopScreenshotPolling(vmId);
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add src/main/vm/vm-manager.ts
git commit -m "feat: add screenshot polling for VM thumbnails"
```

---

## Chunk 3: IPC + Preload + Types

### Task 7: Add New ServerEvent Types

**Files:**
- Modify: `src/renderer/types/index.ts`

- [ ] **Step 1: Add new event types to ServerEvent union and update SessionStatus**

Find the `ServerEvent` type union in `src/renderer/types/index.ts` and add:

```typescript
  | { type: 'vm.screenshot'; payload: { vmId: string; base64: string } }
  | { type: 'vm.interactiveMode'; payload: { vmId: string; enabled: boolean } }
```

Also find the `SessionStatus` type (should be `'idle' | 'running' | 'completed' | 'error'`) and add `'cancelled'`:

```typescript
export type SessionStatus = 'idle' | 'running' | 'completed' | 'error' | 'cancelled';
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/types/index.ts
git commit -m "feat: add vm.screenshot and vm.interactiveMode server event types"
```

### Task 8: Add New IPC Handlers

**Files:**
- Modify: `src/main/ipc/vm.handlers.ts`

- [ ] **Step 1: Add new handlers**

At the end of `registerVMHandlers`, before the closing `}`, add:

```typescript
  ipcMain.handle('vm.checkVRDE', async () => {
    try {
      const vbox = vmManager.getVBoxBackend();
      if (!vbox) return { installed: false, error: 'VirtualBox backend not available' };
      return await vbox.checkVRDE();
    } catch (error) {
      logError('[VM] Error checking VRDE:', error);
      return { installed: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('vm.reconnectVNC', async (_event, vmId: string) => {
    try {
      return await vmManager.reconnectVNC(vmId);
    } catch (error) {
      logError('[VM] Error reconnecting VNC:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('vm.getLatestScreenshot', (_event, vmId: string) => {
    return vmManager.getLatestScreenshot(vmId);
  });

  ipcMain.handle('vm.cancelComputerUse', (_event, vmId: string) => {
    try {
      // Cancel the active ComputerUseSession via VMManager
      const session = vmManager.getActiveComputerUseSession(vmId);
      if (session) {
        session.abort(); // Uses existing abort() method — sets this.aborted = true
      }
      // Emit cancelled status to renderer so UI clears the blue haze
      // Use the session's actual sessionId if available, otherwise vmId
      const sessionId = session ? (session as any).sessionId : vmId;
      deps.sendToRenderer({
        type: 'session.status',
        payload: { sessionId, status: 'cancelled' },
      });
      return { success: true };
    } catch (error) {
      logError('[VM] Error cancelling computer use:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('vm.disableInteractiveMode', (_event, vmId: string) => {
    try {
      deps.sendToRenderer({
        type: 'vm.interactiveMode' as any,
        payload: { vmId, enabled: false },
      });
      return { success: true };
    } catch (error) {
      logError('[VM] Error disabling interactive mode:', error);
      return { success: false };
    }
  });
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/vm.handlers.ts
git commit -m "feat: add VRDE check, VNC reconnect, screenshot, and cancel IPC handlers"
```

### Task 9: Update Preload API

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add new methods to the vm namespace in preload**

Find the `vm:` section in `contextBridge.exposeInMainWorld` and add:

```typescript
      checkVRDE: () => ipcRenderer.invoke('vm.checkVRDE'),
      reconnectVNC: (vmId: string) => ipcRenderer.invoke('vm.reconnectVNC', vmId),
      getLatestScreenshot: (vmId: string) => ipcRenderer.invoke('vm.getLatestScreenshot', vmId),
      cancelComputerUse: (vmId: string) => ipcRenderer.invoke('vm.cancelComputerUse', vmId),
      disableInteractiveMode: (vmId: string) => ipcRenderer.invoke('vm.disableInteractiveMode', vmId),
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: expose new VM IPC methods in preload bridge"
```

---

## Chunk 4: Store + Event Handling

### Task 10: Add Per-VM State to Zustand Store

**Files:**
- Modify: `src/renderer/store/index.ts`
- Create: `tests/vm-store-state.test.ts`

- [ ] **Step 1: Write test for per-VM store state**

```typescript
// tests/vm-store-state.test.ts
import { describe, it, expect } from 'vitest';

describe('VM store state', () => {
  it('should track naviAgentWorkingVMs as a Set', async () => {
    // Verify store has the new fields
    const { useAppStore } = await import('../src/renderer/store/index');
    const store = useAppStore.getState();

    expect(store.naviAgentWorkingVMs).toBeDefined();
    expect(store.naviAgentWorkingVMs instanceof Set).toBe(true);
  });

  it('should track interactiveModeVMs as a Set', async () => {
    const { useAppStore } = await import('../src/renderer/store/index');
    const store = useAppStore.getState();

    expect(store.interactiveModeVMs).toBeDefined();
    expect(store.interactiveModeVMs instanceof Set).toBe(true);
  });

  it('should add/remove from naviAgentWorkingVMs', async () => {
    const { useAppStore } = await import('../src/renderer/store/index');

    useAppStore.getState().setNaviAgentWorking('vm-1', true);
    expect(useAppStore.getState().naviAgentWorkingVMs.has('vm-1')).toBe(true);

    useAppStore.getState().setNaviAgentWorking('vm-1', false);
    expect(useAppStore.getState().naviAgentWorkingVMs.has('vm-1')).toBe(false);
  });

  it('should add/remove from interactiveModeVMs', async () => {
    const { useAppStore } = await import('../src/renderer/store/index');

    useAppStore.getState().setInteractiveMode('vm-1', true);
    expect(useAppStore.getState().interactiveModeVMs.has('vm-1')).toBe(true);

    useAppStore.getState().setInteractiveMode('vm-1', false);
    expect(useAppStore.getState().interactiveModeVMs.has('vm-1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/vm-store-state.test.ts`
Expected: FAIL — fields don't exist

- [ ] **Step 3: Add new state fields and actions to store**

In `src/renderer/store/index.ts`, add to the state interface and initial state:

```typescript
// Add to state interface:
naviAgentWorkingVMs: Set<string>;
interactiveModeVMs: Set<string>;
latestVMScreenshots: Map<string, string>;
setNaviAgentWorking: (vmId: string, working: boolean) => void;
setInteractiveMode: (vmId: string, enabled: boolean) => void;
setVMScreenshot: (vmId: string, base64: string) => void;
```

Add to the `create()` initial state:

```typescript
    naviAgentWorkingVMs: new Set<string>(),
    interactiveModeVMs: new Set<string>(),
    latestVMScreenshots: new Map<string, string>(),
    setNaviAgentWorking: (vmId, working) => set((state) => {
      const next = new Set(state.naviAgentWorkingVMs);
      if (working) next.add(vmId); else next.delete(vmId);
      return { naviAgentWorkingVMs: next };
    }),
    setInteractiveMode: (vmId, enabled) => set((state) => {
      const next = new Set(state.interactiveModeVMs);
      if (enabled) next.add(vmId); else next.delete(vmId);
      return { interactiveModeVMs: next };
    }),
    setVMScreenshot: (vmId, base64) => set((state) => {
      const next = new Map(state.latestVMScreenshots);
      next.set(vmId, base64);
      return { latestVMScreenshots: next };
    }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/vm-store-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/store/index.ts tests/vm-store-state.test.ts
git commit -m "feat: add per-VM agent working, interactive mode, and screenshot state to store"
```

### Task 11: Handle New Events in useIPC Hook

**Files:**
- Modify: `src/renderer/hooks/useIPC.ts`

- [ ] **Step 1: Add event handlers for new events**

In `useIPC.ts`, in the server event listener switch/if chain, add handlers:

```typescript
      // After existing vm.provisionProgress handler:

      case 'vm.screenshot': {
        const { vmId, base64 } = event.payload as { vmId: string; base64: string };
        store.setVMScreenshot(vmId, base64);
        break;
      }

      case 'vm.interactiveMode': {
        const { vmId, enabled } = event.payload as { vmId: string; enabled: boolean };
        store.setInteractiveMode(vmId, enabled);
        break;
      }
```

Also update the `session.status` handler to track `naviAgentWorking`:

```typescript
      // In the existing session.status handler, add:
      case 'session.status': {
        const { sessionId, status } = event.payload as any;
        // ... existing handling ...

        // Track Navi agent working state for VM overlay
        if (status === 'running') {
          store.setNaviAgentWorking(sessionId, true);
        } else if (status === 'idle' || status === 'error' || status === 'cancelled') {
          store.setNaviAgentWorking(sessionId, false);
        }
        break;
      }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/hooks/useIPC.ts
git commit -m "feat: handle vm.screenshot, vm.interactiveMode, and session cancellation events"
```

---

## Chunk 5: UI — VMDesktopViewer (Haze + Interactive Mode)

### Task 12: Add Blue Haze Overlay and Status Pill

**Files:**
- Modify: `src/renderer/components/VMDesktopViewer.tsx`

- [ ] **Step 1: Add props for agent working and interactive mode**

Update the props interface:

```typescript
interface VMDesktopViewerProps {
  wsUrl: string;
  vmId: string;
  vmName: string;
  viewOnly?: boolean;
  isAgentWorking?: boolean;
  isInteractive?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onStopAgent?: () => void;
  className?: string;
}
```

- [ ] **Step 2: Add the haze overlay and status pill**

After the VNC canvas `</div>`, before the disconnected overlay, add:

```tsx
        {/* Blue haze overlay when Navi is working */}
        {isAgentWorking && (
          <div
            className="absolute inset-0 pointer-events-none transition-opacity duration-300"
            style={{
              background: 'rgba(59, 130, 246, 0.12)',
              animation: 'navi-haze 2s ease-in-out infinite',
              boxShadow: 'inset 0 0 40px rgba(59, 130, 246, 0.15)',
            }}
          />
        )}

        {/* Status pill */}
        {isAgentWorking && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2 rounded-full bg-surface border border-border shadow-lg">
            <span
              className="w-2 h-2 rounded-full bg-blue-500"
              style={{ animation: 'pulse 1.5s ease-in-out infinite' }}
            />
            <span className="text-xs font-medium text-text-primary">Navi is working...</span>
            <button
              onClick={onStopAgent}
              className="ml-1 px-2 py-0.5 rounded-md text-xs font-medium text-red-500 hover:bg-red-500/10 transition-colors pointer-events-auto"
            >
              Stop
            </button>
          </div>
        )}

        {/* Interactive mode banner */}
        {isInteractive && (
          <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-center gap-2 px-4 py-2 bg-yellow-500/90 text-black text-xs font-medium">
            You have keyboard control — press Esc to release
          </div>
        )}
```

- [ ] **Step 3: Add CSS keyframes for the haze animation**

Add a `<style>` tag inside the component (or in the global CSS):

```tsx
  // At the top of the component function, add:
  useEffect(() => {
    // Inject keyframes if not already present
    if (!document.getElementById('navi-haze-styles')) {
      const style = document.createElement('style');
      style.id = 'navi-haze-styles';
      style.textContent = `
        @keyframes navi-haze {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);
```

- [ ] **Step 4: Add Esc key handler for interactive mode**

```tsx
  // Add Esc key listener for interactive mode
  useEffect(() => {
    if (!isInteractive) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const api = (window as any).electronAPI;
        api?.vm?.disableInteractiveMode(vmId);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isInteractive, vmId]);
```

- [ ] **Step 5: Add 3-minute inactivity auto-disable for interactive mode**

```tsx
  // Auto-disable interactive mode after 3 minutes of no input
  useEffect(() => {
    if (!isInteractive) return;
    let lastActivity = Date.now();
    const TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

    const activityHandler = () => { lastActivity = Date.now(); };
    const checkTimer = setInterval(() => {
      if (Date.now() - lastActivity > TIMEOUT_MS) {
        const api = (window as any).electronAPI;
        api?.vm?.disableInteractiveMode(vmId);
      }
    }, 10000); // Check every 10s

    // Track keyboard and mouse activity inside the VNC container
    const container = containerRef.current;
    container?.addEventListener('keydown', activityHandler);
    container?.addEventListener('mousemove', activityHandler);
    container?.addEventListener('click', activityHandler);

    return () => {
      clearInterval(checkTimer);
      container?.removeEventListener('keydown', activityHandler);
      container?.removeEventListener('mousemove', activityHandler);
      container?.removeEventListener('click', activityHandler);
    };
  }, [isInteractive, vmId]);
```

- [ ] **Step 6: Remove the "View only" indicator from the toolbar**

Remove lines 84-89 (the `viewOnly &&` block showing Eye icon and "View only" text) — viewOnly is now always true, no need to display it.

- [ ] **Step 7: Wire viewOnly to always true unless interactive**

Change the VncScreen component's `viewOnly` prop:

```tsx
          viewOnly={!isInteractive}
```

- [ ] **Step 8: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 9: Commit**

```bash
git add src/renderer/components/VMDesktopViewer.tsx
git commit -m "feat: add blue haze overlay, status pill, and interactive mode to VMDesktopViewer"
```

---

## Chunk 6: UI — CoworkDesktopView + VMView Changes

### Task 13: Update CoworkDesktopView

**Files:**
- Modify: `src/renderer/components/CoworkDesktopView.tsx`

- [ ] **Step 1: Wire store state and remove view-only toggle**

Replace the component's store usage and control bar:

```tsx
  const {
    activeCoworkVM,
    coworkVNCUrl,
    coworkComputerUseEnabled,
    setCoworkComputerUseEnabled,
    setActiveCoworkVM,
    setCoworkVNCUrl,
    naviAgentWorkingVMs,
    interactiveModeVMs,
  } = useAppStore();

  const [vncConnected, setVncConnected] = useState(false);

  const vmId = activeCoworkVM?.id;
  const isAgentWorking = vmId ? naviAgentWorkingVMs.has(vmId) : false;
  const isInteractive = vmId ? interactiveModeVMs.has(vmId) : false;
```

Pass new props to VMDesktopViewer:

```tsx
          <VMDesktopViewer
            wsUrl={coworkVNCUrl}
            vmId={activeCoworkVM.id}
            vmName={activeCoworkVM.name}
            isAgentWorking={isAgentWorking}
            isInteractive={isInteractive}
            onConnect={() => setVncConnected(true)}
            onDisconnect={() => setVncConnected(false)}
            onStopAgent={async () => {
              const api = (window as any).electronAPI;
              await api?.vm?.cancelComputerUse(activeCoworkVM.id);
            }}
            className="h-full"
          />
```

- [ ] **Step 2: Remove the view-only toggle from ControlBar**

In the `ControlBar` component, remove the `onToggleViewOnly` prop and the Eye/EyeOff toggle button. Keep the Computer Use toggle, connection status, and Stop VM button.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/CoworkDesktopView.tsx
git commit -m "feat: wire agent working state, remove view-only toggle from CoworkDesktopView"
```

### Task 14: Update VMView — Start with VNC + Navigate

**Files:**
- Modify: `src/renderer/components/VMView.tsx`

- [ ] **Step 1: Change startVM to use startWithVNC and navigate**

Replace the `startVM` callback (line 170):

```typescript
  const startVM = async (vmId: string, vmName: string) => {
    setLoading(true);
    setActionLabel('Starting VM...');
    setError(null);
    try {
      // Check VRDE first
      const vrdeCheck = await window.electronAPI.vm.checkVRDE();
      if (!vrdeCheck.installed) {
        setError('VirtualBox Extension Pack is required for embedded display. Please install it from virtualbox.org.');
        setLoading(false);
        setActionLabel('');
        return;
      }

      const result = await window.electronAPI.vm.startWithVNC(vmId);
      if (result.success && result.wsUrl) {
        // Navigate to CoworkDesktopView
        setActiveCoworkVM({ id: vmId, name: vmName, state: 'running' });
        setCoworkVNCUrl(result.wsUrl);
        setActiveView('cowork-desktop');
      } else {
        setError(result.error || 'Failed to start VM');
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start VM');
    } finally {
      setLoading(false);
      setActionLabel('');
    }
  };
```

Add store imports at the top destructuring:

```typescript
  const {
    // ... existing ...
    setActiveCoworkVM,
    setCoworkVNCUrl,
    setActiveView,
    latestVMScreenshots,
  } = useAppStore();
```

- [ ] **Step 2: Update the Start button in VMCard to pass vmName**

In the VMCard's start button, change:

```tsx
                  onStart={() => startVM(vm.id)}
```
to:
```tsx
                  onStart={() => startVM(vm.id, vm.name)}
```

And update the VMCardProps and `onStart` type:

```typescript
  onStart: () => void;
```
to:
```typescript
  onStart: (vmId: string, vmName: string) => void;
```

Wait — actually it's simpler to just pass the name through the existing callback:

```tsx
                  onStart={() => startVM(vm.id, vm.name)}
```

The `onStart` prop stays `() => void` since the caller provides the closure.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/VMView.tsx
git commit -m "feat: VMView Start button uses startWithVNC and navigates to embedded desktop"
```

### Task 15: Add Overflow Menu with Hidden VBox Escape Hatch

**Files:**
- Modify: `src/renderer/components/VMView.tsx`

- [ ] **Step 1: Add MoreVertical import and overflow menu state**

Add to imports:

```typescript
import { MoreVertical } from 'lucide-react';
```

In VMCard, add state:

```typescript
  const [showOverflow, setShowOverflow] = useState(false);
```

- [ ] **Step 2: Add the overflow menu button and dropdown**

After the existing action buttons in VMCard, add an overflow menu for running VMs:

```tsx
          {/* Overflow menu */}
          {(vm.state === 'running' || vm.state === 'powered_off') && (
            <div className="relative">
              <button
                onClick={() => setShowOverflow(!showOverflow)}
                className="p-2 rounded-lg hover:bg-surface-hover text-text-muted transition-colors"
                title="More options"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              {showOverflow && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowOverflow(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-surface border border-border rounded-xl shadow-xl py-1">
                    {vm.state === 'running' && (
                      <button
                        onClick={() => { onOpenDisplay(); setShowOverflow(false); }}
                        className="w-full text-left px-4 py-2 text-xs text-text-muted hover:bg-surface-hover transition-colors"
                      >
                        Advanced: Open in VirtualBox
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
```

- [ ] **Step 3: Replace the old Open Display button**

Remove the existing `onOpenDisplay` button from the `vm.state === 'running'` action buttons section (the one with `ExternalLink` icon). It's now in the overflow menu only.

Replace it with an "Open Desktop" button that navigates to CoworkDesktopView:

```tsx
              <button
                onClick={() => startVM(vm.id, vm.name)}
                disabled={loading}
                className="p-2 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
                title="Open Desktop"
              >
                <Monitor className="w-4 h-4" />
              </button>
```

Wait — for a running VM, we should reconnect rather than start. Add a new handler:

```typescript
  const openDesktop = async (vmId: string, vmName: string) => {
    setLoading(true);
    setActionLabel('Connecting to VM...');
    try {
      // Try to get existing VNC URL first
      let wsUrl = await window.electronAPI.vm.getVNCUrl(vmId);
      if (!wsUrl) {
        // Reconnect
        const result = await window.electronAPI.vm.reconnectVNC(vmId);
        if (result.success && result.wsUrl) {
          wsUrl = result.wsUrl;
        }
      }
      if (wsUrl) {
        setActiveCoworkVM({ id: vmId, name: vmName, state: 'running' });
        setCoworkVNCUrl(wsUrl);
        setActiveView('cowork-desktop');
      } else {
        setError('Could not connect to VM display');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setLoading(false);
      setActionLabel('');
    }
  };
```

Then the running VM's primary button becomes:

```tsx
              <button
                onClick={() => openDesktop(vm.id, vm.name)}
                disabled={loading}
                className="p-2 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
                title="Open Desktop"
              >
                <Monitor className="w-4 h-4" />
              </button>
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/VMView.tsx
git commit -m "feat: add overflow menu with hidden VBox escape hatch, replace Open Display with Open Desktop"
```

### Task 16: Add VM Thumbnail to VMCard

**Files:**
- Modify: `src/renderer/components/VMView.tsx`

- [ ] **Step 1: Add thumbnail display in VMCard**

In VMCard, after the VM info section and before the actions, add a thumbnail for running VMs:

```tsx
  // Get screenshot from store
  const screenshot = latestVMScreenshots?.get(vm.id);
```

Pass `latestVMScreenshots` as a prop to VMCard (from the parent's store access).

Add the thumbnail between info and actions:

```tsx
        {/* VM Thumbnail */}
        {vm.state === 'running' && screenshot && (
          <div className="mt-3">
            <img
              src={`data:image/png;base64,${screenshot}`}
              alt={`${vm.name} screen`}
              className="w-full rounded-lg border border-border object-cover"
              style={{ maxHeight: '120px' }}
            />
          </div>
        )}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/VMView.tsx
git commit -m "feat: show VM screenshot thumbnail in VMCard for running VMs"
```

---

## Chunk 7: Sidebar Indicator + Notifications

### Task 17: Add Blue Navi-Working Dot to Sidebar

**Files:**
- Modify: `src/renderer/components/Sidebar.tsx`

- [ ] **Step 1: Add naviAgentWorkingVMs to store destructuring**

```typescript
  const {
    // ... existing ...
    naviAgentWorkingVMs,
  } = useAppStore();
```

- [ ] **Step 2: Add blue dot to Cowork Desktop button**

Find the existing green dot for `activeCoworkVM` (line 299-301). Change it to show either a green dot (VM active) or a blue pulsing dot (Navi working):

```tsx
            {activeCoworkVM && (
              <div
                className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface ${
                  naviAgentWorkingVMs.size > 0
                    ? 'bg-blue-500'
                    : 'bg-green-500'
                }`}
                style={naviAgentWorkingVMs.size > 0 ? { animation: 'pulse 1.5s ease-in-out infinite' } : undefined}
                title={naviAgentWorkingVMs.size > 0 ? 'Navi is working...' : 'VM active'}
              />
            )}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/Sidebar.tsx
git commit -m "feat: add blue pulsing dot to sidebar when Navi is working on a VM"
```

### Task 18: Add Toast Notifications for Background Agent Work

**Files:**
- Modify: `src/renderer/hooks/useIPC.ts`

- [ ] **Step 1: Add notification on session completion/error when user is not on cowork-desktop view**

In the `session.status` handler, after updating the store:

```typescript
        // Notify user if they're on a different view
        if (status === 'idle' || status === 'error' || status === 'cancelled') {
          const currentView = useAppStore.getState().activeView;
          if (currentView !== 'cowork-desktop') {
            // Simple notification — use Electron Notification API if available
            if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
              new Notification(
                status === 'error' ? 'Navi needs your help' : 'Navi finished',
                { body: status === 'error' ? 'Something went wrong on the VM' : 'Task completed on the VM' },
              );
            }
          }
        }
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/hooks/useIPC.ts
git commit -m "feat: send system notification when Navi completes VM work in background"
```

---

## Chunk 8: Computer Use Session — Interactive Mode Tool

### Task 19: Add enable_user_input Tool to ComputerUseSession

**Files:**
- Modify: `src/main/vm/computer-use-session.ts`

- [ ] **Step 0: Add vmId to ComputerUseSession options**

The session needs to know the vmId to emit `vm.interactiveMode` events. Add it to the options interface and constructor:

```typescript
interface ComputerUseSessionOptions {
  adapter: ComputerUseProvider;
  apiKey: string;
  model?: string;
  maxLoops?: number;
  sendToRenderer: (event: ServerEvent) => void;
  saveMessage?: (message: Message) => void;
  sessionId: string;
  vmId?: string; // NEW — for interactive mode events
}
```

Store it in the constructor:

```typescript
  private vmId: string;
  // In constructor:
  this.vmId = options.vmId || '';
```

The agent-runner must pass `vmId` when creating a `ComputerUseSession`.

- [ ] **Step 1: Add the custom tool to the tools array**

In the `run()` method, after the `computer` tool definition, add. Note the `type: 'custom'` field which the Anthropic API requires for non-built-in tools:

```typescript
      {
        type: 'custom',
        name: 'enable_user_input',
        description: 'Temporarily grant the user direct keyboard/mouse access to the VM. Call this when the user needs to type sensitive input (passwords, 2FA codes) or when they explicitly ask to interact with the VM directly.',
        input_schema: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'Why the user needs direct input access',
            },
          },
          required: ['reason'],
        },
      },
```

- [ ] **Step 2: Handle the enable_user_input tool call in the loop**

In the tool_use block handler, before the `execute` call, add a check:

```typescript
          if (block.type === 'tool_use' && block.name === 'enable_user_input') {
            // Emit interactive mode event to renderer
            this.sendToRenderer({
              type: 'vm.interactiveMode' as any,
              payload: { vmId: (this.adapter as any).vmId || '', enabled: true },
            });

            // Return a success result
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: [{ type: 'text', text: 'User has been granted keyboard and mouse access to the VM. They can press Esc to release control back to you.' }],
            });

            // Emit trace step
            this.sendToRenderer({
              type: 'trace.step',
              payload: {
                sessionId: this.sessionId,
                step: {
                  id: uuidv4(),
                  type: 'tool_call',
                  status: 'completed',
                  title: 'Enabled user input',
                  toolName: 'enable_user_input',
                  toolInput: block.input as Record<string, unknown>,
                  timestamp: Date.now(),
                },
              },
            });

            continue; // Skip the computer use adapter execution
          }
```

Wait — this needs to go inside the `for (const block of response.content)` loop but BEFORE the existing computer use handler. Let me restructure:

In the loop over `response.content`, change the `if (block.type === 'tool_use')` block to check the tool name first:

```typescript
          if (block.type === 'tool_use') {
            if (block.name === 'enable_user_input') {
              // Handle interactive mode tool
              this.sendToRenderer({
                type: 'vm.interactiveMode' as any,
                payload: { vmId: this.vmId, enabled: true },
              });

              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: [{ type: 'text', text: 'User has been granted keyboard and mouse access. They can press Esc to release control.' }],
              });
            } else {
              // Existing computer use handler (screenshot, click, type, etc.)
              // ... existing code ...
            }
          }
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/main/vm/computer-use-session.ts
git commit -m "feat: add enable_user_input tool to ComputerUseSession for Navi-gated interactive mode"
```

---

## Chunk 9: Custom ISO Import + VMCreateWizard Defaults

### Task 20: Update VMImageRegistry to Accept osFamily

**Files:**
- Modify: `src/main/vm/vm-image-registry.ts`

- [ ] **Step 1: Update importISO signature**

Change the `importISO` method to accept an optional `osFamily`:

```typescript
  async importISO(filePath: string, name: string, osFamily?: string): Promise<OSImage> {
```

Map osFamily to vboxOsType:

```typescript
    const osFamilyMap: Record<string, string> = {
      'ubuntu-debian': 'Ubuntu_64',
      'fedora-rhel': 'Fedora_64',
      'arch': 'ArchLinux_64',
      'windows': 'Windows11_64',
      'other': 'Linux_64',
    };
    const vboxOsType = osFamilyMap[osFamily || 'other'] || 'Linux_64';
```

Use it in the image object:

```typescript
      vboxOsType,
```

instead of the hardcoded `'Linux_64'`.

- [ ] **Step 2: Update VMManager.importISO to pass osFamily**

In `vm-manager.ts`, update the `importISO` call:

```typescript
  async importISO(filePath: string, name: string, osFamily?: string): Promise<OSImage | null> {
    return (await this.imageRegistry?.importISO(filePath, name, osFamily)) || null;
  }
```

- [ ] **Step 3: Update IPC handler for importISO**

In `vm.handlers.ts`, the `vm.importISO` handler needs to pass the OS family. Since this currently uses a dialog, we'll need to add a second step. For now, keep the dialog flow and add osFamily as a follow-up IPC:

Actually, the import flow currently opens a file dialog and returns immediately. The OS family selection should happen in the VMCreateWizard UI before calling import. Update the IPC:

```typescript
  ipcMain.handle('vm.importISO', async (_event, osFamily?: string) => {
    // ... existing dialog code ...
    const image = await vmManager.importISO(filePath, fileName, osFamily);
    // ... rest unchanged ...
  });
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add src/main/vm/vm-image-registry.ts src/main/vm/vm-manager.ts src/main/ipc/vm.handlers.ts
git commit -m "feat: accept OS family in custom ISO import for correct vboxOsType mapping"
```

### Task 21: Update VMCreateWizard Defaults + OS Family Dropdown

**Files:**
- Modify: `src/renderer/components/VMCreateWizard.tsx`

- [ ] **Step 1: Change default displayMode to 'embedded'**

Find where `displayMode` is initialized (likely `'separate_window'`) and change to `'embedded'`.

- [ ] **Step 2: Add OS family dropdown for custom ISO imports**

In the import ISO section of VMCreateWizard (where the "Import ISO" button is), add a dropdown that appears after the user selects a file:

```tsx
  const [osFamily, setOsFamily] = useState<string>('other');

  // In the UI, after the import button or in a step before creating the VM:
  <div className="space-y-2">
    <label className="text-sm font-medium text-text-primary">OS Family (optional)</label>
    <select
      value={osFamily}
      onChange={(e) => setOsFamily(e.target.value)}
      className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary"
    >
      <option value="ubuntu-debian">Ubuntu / Debian</option>
      <option value="fedora-rhel">Fedora / RHEL</option>
      <option value="arch">Arch Linux</option>
      <option value="windows">Windows</option>
      <option value="other">Other Linux (default)</option>
    </select>
    <p className="text-xs text-text-muted">Helps configure optimal VM settings for your OS.</p>
  </div>
```

Pass `osFamily` when calling the import IPC:

```typescript
  const result = await window.electronAPI.vm.importISO(osFamily);
```

Update the preload `importISO` to accept the parameter:

```typescript
  importISO: (osFamily?: string) => ipcRenderer.invoke('vm.importISO', osFamily),
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/VMCreateWizard.tsx src/preload/index.ts
git commit -m "feat: default displayMode to 'embedded', add OS family dropdown for custom ISO imports"
```

---

## Chunk 10: Final Verification

### Task 22: Full TypeScript Build Check

- [ ] **Step 1: Run full TypeScript check**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Run the app**

Run: `unset ELECTRON_RUN_AS_NODE && npm run dev`
Expected: App launches, VM management page loads, new graphics defaults active

- [ ] **Step 4: Manual test — start a VM**

1. Go to VM management
2. Click Start on a powered-off VM
3. Should see VRDE check pass (or Extension Pack prompt if missing)
4. Should navigate to CoworkDesktopView automatically
5. noVNC viewer should connect and show the VM desktop
6. No VirtualBox GUI window should appear
7. VM display should be view-only (mouse/keyboard don't interact)

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: seamless VM integration — complete implementation"
```
