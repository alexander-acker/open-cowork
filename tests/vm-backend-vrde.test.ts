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
