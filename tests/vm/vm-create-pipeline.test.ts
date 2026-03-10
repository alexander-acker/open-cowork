import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-app' },
}));

vi.mock('../../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

import { execFile } from 'child_process';
import { VirtualBoxBackend } from '../../src/main/vm/backends/virtualbox-backend';
import type { VMConfig } from '../../src/main/vm/types';

function makeConfig(name = 'TestVM'): VMConfig {
  return {
    id: 'test-id-123',
    name,
    osImageId: 'ubuntu-24',
    resources: {
      cpuCount: 2,
      memoryMb: 4096,
      diskSizeGb: 25,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    backendType: 'virtualbox',
    backendVmId: 'Ubuntu_64',
  };
}

describe('VM creation pipeline', () => {
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

      // Simulate createvm output with settings path
      if (args[0] === 'createvm') {
        cb(null, "Virtual machine 'TestVM' is created and registered.\nUUID: abc-123\nSettings file: '/home/user/VMs/TestVM/TestVM.vbox'", '');
      } else {
        cb(null, '', '');
      }
      return {} as any;
    });
  });

  it('executes all 5 VBoxManage steps in order', async () => {
    const result = await backend.createVM(makeConfig(), '/iso/ubuntu.iso');

    expect(result.success).toBe(true);

    // Step 1: createvm
    expect(callLog[0]).toEqual(['createvm', '--name', 'TestVM', '--ostype', 'Ubuntu_64', '--register']);

    // Step 2: modifyvm (hardware)
    expect(callLog[1][0]).toBe('modifyvm');
    expect(callLog[1]).toContain('--cpus');
    expect(callLog[1]).toContain('2');
    expect(callLog[1]).toContain('--memory');
    expect(callLog[1]).toContain('4096');
    expect(callLog[1]).toContain('--firmware');
    expect(callLog[1]).toContain('efi');

    // Step 3: createmedium (disk)
    expect(callLog[2][0]).toBe('createmedium');
    expect(callLog[2]).toContain('--size');
    expect(callLog[2]).toContain('25600'); // 25 * 1024

    // Step 4: storagectl (SATA)
    expect(callLog[3][0]).toBe('storagectl');
    expect(callLog[3]).toContain('SATA');

    // Step 5: storageattach (disk)
    expect(callLog[4][0]).toBe('storageattach');
    expect(callLog[4]).toContain('hdd');

    // Step 6: storageattach (ISO)
    expect(callLog[5][0]).toBe('storageattach');
    expect(callLog[5]).toContain('dvddrive');
    expect(callLog[5]).toContain('/iso/ubuntu.iso');

    // Step 7: boot order
    expect(callLog[6][0]).toBe('modifyvm');
    expect(callLog[6]).toContain('--boot1');
    expect(callLog[6]).toContain('dvd');
  });

  it('uses vmFolder from settings path for disk location', async () => {
    await backend.createVM(makeConfig(), '/iso/ubuntu.iso');

    // createmedium should use the VM folder for disk path
    const createMediumArgs = callLog[2];
    const filenameIdx = createMediumArgs.indexOf('--filename');
    const diskPath = createMediumArgs[filenameIdx + 1];
    // Normalize separators for cross-platform (Windows uses \ from path.dirname)
    const normalized = diskPath.replace(/\\/g, '/');
    expect(normalized).toContain('/home/user/VMs/TestVM/');
    expect(diskPath.endsWith('.vdi')).toBe(true);
  });

  it('cleans up on VBoxManage failure at step 3', async () => {
    let callCount = 0;
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: any) => {
      callCount++;
      callLog.push(args);

      if (args[0] === 'createvm') {
        cb(null, "Settings file: '/home/user/VMs/TestVM/TestVM.vbox'", '');
      } else if (args[0] === 'createmedium') {
        cb(new Error('VBOX_E_FILE_ERROR: disk creation failed'), '', 'disk error');
      } else if (args[0] === 'unregistervm') {
        cb(null, '', ''); // cleanup succeeds
      } else {
        cb(null, '', '');
      }
      return {} as any;
    });

    const result = await backend.createVM(makeConfig(), '/iso/ubuntu.iso');

    expect(result.success).toBe(false);
    expect(result.error).toContain('disk creation failed');

    // Should attempt cleanup
    const cleanupCall = callLog.find(args => args[0] === 'unregistervm');
    expect(cleanupCall).toBeDefined();
    expect(cleanupCall).toContain('--delete');
  });

  it('returns error when VBoxManage path is not set', async () => {
    (backend as any).vboxManagePath = null;

    const result = await backend.createVM(makeConfig(), '/iso/ubuntu.iso');
    expect(result.success).toBe(false);
    expect(result.error).toContain('VBoxManage not found');
  });

  it('passes correct osType from config.backendVmId', async () => {
    const config = makeConfig();
    config.backendVmId = 'Linux_64';

    await backend.createVM(config, '/iso/zorin.iso');

    expect(callLog[0]).toContain('--ostype');
    expect(callLog[0]).toContain('Linux_64');
  });
});
