import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process before importing the backend
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

// Mock electron
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-app' },
}));

// Mock logger to avoid electron dependency
vi.mock('../../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

// Mock fs for findVBoxManage
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn((p: string) => {
      if (p.includes('VBoxManage')) return true;
      return actual.existsSync(p);
    }),
  };
});

import { execFile } from 'child_process';
import { VirtualBoxBackend } from '../../src/main/vm/backends/virtualbox-backend';
import type { VMConfig, VMResourceConfig } from '../../src/main/vm/types';

function makeConfig(name: string): VMConfig {
  return {
    id: 'test-id',
    name,
    osImageId: 'test-image',
    resources: {
      cpuCount: 2,
      memoryMb: 4096,
      diskSizeGb: 25,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    backendType: 'virtualbox',
    backendVmId: 'Linux_64',
  };
}

describe('VM name validation', () => {
  let backend: VirtualBoxBackend;

  beforeEach(async () => {
    backend = new VirtualBoxBackend();
    // Simulate successful availability check
    (backend as any).vboxManagePath = 'C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe';
  });

  it('accepts simple alphanumeric names', async () => {
    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
      cb(null, "Settings file: 'C:\\VMs\\TestVM\\TestVM.vbox'", '');
      return {} as any;
    });

    const result = await backend.createVM(makeConfig('MyTestVM'), '/path/to/iso');
    expect(result.success).toBe(true);
  });

  it('accepts names with dots', async () => {
    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
      cb(null, "Settings file: 'C:\\VMs\\Ubuntu.22.04\\Ubuntu.22.04.vbox'", '');
      return {} as any;
    });

    const result = await backend.createVM(makeConfig('Ubuntu.22.04'), '/path/to/iso');
    expect(result.success).toBe(true);
  });

  it('accepts names with spaces, dashes, underscores', async () => {
    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
      cb(null, "Settings file: 'C:\\VMs\\My VM-Test_1\\My VM-Test_1.vbox'", '');
      return {} as any;
    });

    const result = await backend.createVM(makeConfig('My VM-Test_1'), '/path/to/iso');
    expect(result.success).toBe(true);
  });

  it('accepts Zorin-OS-18-Pro-64-bit (stripped of .iso)', async () => {
    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
      cb(null, "Settings file: 'C:\\VMs\\Zorin-OS-18-Pro-64-bit\\Zorin-OS-18-Pro-64-bit.vbox'", '');
      return {} as any;
    });

    const result = await backend.createVM(makeConfig('Zorin-OS-18-Pro-64-bit'), '/path/to/iso');
    expect(result.success).toBe(true);
  });

  it('rejects names with parentheses', async () => {
    const result = await backend.createVM(makeConfig('Zorin-OS (1)'), '/path/to/iso');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid VM name');
  });

  it('rejects names with special characters !@#$%', async () => {
    for (const char of ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '+', '=']) {
      const result = await backend.createVM(makeConfig(`test${char}name`), '/path/to/iso');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid VM name');
    }
  });

  it('rejects empty name', async () => {
    const result = await backend.createVM(makeConfig(''), '/path/to/iso');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid VM name');
  });

  it('rejects name longer than 255 chars', async () => {
    const longName = 'A'.repeat(256);
    const result = await backend.createVM(makeConfig(longName), '/path/to/iso');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid VM name');
  });

  it('accepts name exactly 255 chars', async () => {
    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
      cb(null, "Settings file: 'C:\\VMs\\test\\test.vbox'", '');
      return {} as any;
    });

    const name = 'A'.repeat(255);
    const result = await backend.createVM(makeConfig(name), '/path/to/iso');
    expect(result.success).toBe(true);
  });
});
