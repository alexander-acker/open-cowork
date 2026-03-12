import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-app' },
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

import { execFile } from 'child_process';
import { VirtualBoxBackend } from '../src/main/vm/backends/virtualbox-backend';
import type { VMConfig } from '../src/main/vm/types';

function makeConfig(name = 'TestVM'): VMConfig {
  return {
    id: 'test-id-123',
    name,
    osImageId: 'ubuntu-24',
    resources: {
      cpuCount: 2,
      memoryMb: 4096,
      diskSizeGb: 25,
      displayMode: 'embedded',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    backendType: 'virtualbox',
    backendVmId: 'Ubuntu_64',
  };
}

describe('VirtualBoxBackend — graphics controller defaults', () => {
  let backend: VirtualBoxBackend;
  let mockExecFile: ReturnType<typeof vi.fn>;
  let callLog: string[][];

  beforeEach(() => {
    backend = new VirtualBoxBackend();
    (backend as any).vboxManagePath = '/usr/bin/VBoxManage';

    callLog = [];
    mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: any) => {
      callLog.push(args);
      if (args[0] === 'createvm') {
        cb(null, "Virtual machine 'TestVM' is created.\nSettings file: '/home/user/VMs/TestVM/TestVM.vbox'", '');
      } else {
        cb(null, '', '');
      }
      return {} as any;
    });
  });

  it('uses VBoxSVGA graphics controller (not vmsvga)', async () => {
    await backend.createVM(makeConfig(), '/iso/ubuntu.iso');

    const modifyArgs = callLog.find(args => args[0] === 'modifyvm' && args.includes('--graphicscontroller'));
    expect(modifyArgs).toBeDefined();
    const idx = modifyArgs!.indexOf('--graphicscontroller');
    expect(modifyArgs![idx + 1]).toBe('VBoxSVGA');
  });

  it('disables 3D acceleration', async () => {
    await backend.createVM(makeConfig(), '/iso/ubuntu.iso');

    const modifyArgs = callLog.find(args => args[0] === 'modifyvm' && args.includes('--graphicscontroller'));
    expect(modifyArgs).toBeDefined();
    expect(modifyArgs).toContain('--accelerate3d');
    const idx = modifyArgs!.indexOf('--accelerate3d');
    expect(modifyArgs![idx + 1]).toBe('off');
  });
});

describe('VirtualBoxBackend — checkVRDE', () => {
  let backend: VirtualBoxBackend;
  let mockExecFile: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    backend = new VirtualBoxBackend();
    (backend as any).vboxManagePath = '/usr/bin/VBoxManage';
    mockExecFile = vi.mocked(execFile);
  });

  it('returns installed: true when extpacks output shows count >= 1', async () => {
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: any) => {
      if (args[0] === 'list' && args[1] === 'extpacks') {
        cb(null, 'Extension Packs: 1\nPack no. 0:   Oracle VM VirtualBox Extension Pack\nVersion:      7.0.14\n', '');
      } else {
        cb(null, '', '');
      }
      return {} as any;
    });

    const result = await backend.checkVRDE();
    expect(result.installed).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns installed: false when extpacks output shows count 0', async () => {
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: any) => {
      if (args[0] === 'list' && args[1] === 'extpacks') {
        cb(null, 'Extension Packs: 0\n', '');
      } else {
        cb(null, '', '');
      }
      return {} as any;
    });

    const result = await backend.checkVRDE();
    expect(result.installed).toBe(false);
  });

  it('returns installed: false with error message when VBoxManage fails', async () => {
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: any) => {
      if (args[0] === 'list' && args[1] === 'extpacks') {
        cb(new Error('VBoxManage: command not found'), '', '');
      } else {
        cb(null, '', '');
      }
      return {} as any;
    });

    const result = await backend.checkVRDE();
    expect(result.installed).toBe(false);
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
  });
});
