import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn((name: string) => path.join(os.tmpdir(), name)),
    getVersion: () => '0.0.0',
  },
  dialog: {
    showMessageBox: vi.fn(),
  },
}));

import { SandboxAdapter } from '../src/main/sandbox/sandbox-adapter';
import { configStore } from '../src/main/config/config-store';

describe('SandboxAdapter', () => {
  it('should initialize successfully in fallback mode if sandbox is disabled', async () => {
    vi.spyOn(configStore, 'get').mockImplementation((key) => {
      if (key === 'sandboxEnabled') return false;
      return null;
    });

    // Use a real temp directory so the workspace path check passes
    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-test-'));
    try {
      const adapter = new SandboxAdapter();
      await adapter.initialize({ workspacePath: tmpWorkspace });

      expect(adapter.initialized).toBe(true);
      expect(adapter.mode).toBe('native');
    } finally {
      fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    }
  });

  it('should expose the correct path converters', () => {
    const adapter = new SandboxAdapter();
    const converter = adapter.getPathConverter();
    expect(converter.toWSL).toBeDefined();
    expect(converter.toWindows).toBeDefined();
  });
});
