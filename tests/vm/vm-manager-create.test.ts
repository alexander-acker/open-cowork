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

vi.mock('../../src/main/vm/vm-config-store', () => ({
  vmConfigStore: {
    get: vi.fn().mockReturnValue({}),
    set: vi.fn(),
    addVM: vi.fn(),
  },
}));

vi.mock('uuid', () => ({
  v4: () => 'mock-uuid-1234',
}));

import { execFile } from 'child_process';
import { vmManager } from '../../src/main/vm/vm-manager';
import { vmConfigStore } from '../../src/main/vm/vm-config-store';

describe('VMManager.createVM', () => {
  beforeEach(() => {
    // Reset the manager state
    (vmManager as any).backend = null;
    (vmManager as any).imageRegistry = null;
    (vmManager as any).backendStatus = null;
  });

  it('returns error when backend is not initialized', async () => {
    const result = await vmManager.createVM('TestVM', 'image-123', {
      cpuCount: 2,
      memoryMb: 4096,
      diskSizeGb: 25,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('VM backend not available');
  });

  it('returns error when image is not downloaded', async () => {
    // Set up a mock backend and registry
    (vmManager as any).backend = {
      createVM: vi.fn(),
    };
    (vmManager as any).imageRegistry = {
      getImagePath: vi.fn().mockReturnValue(null),
      getAvailableCatalog: vi.fn().mockReturnValue([]),
    };

    const result = await vmManager.createVM('TestVM', 'nonexistent-image', {
      cpuCount: 2,
      memoryMb: 4096,
      diskSizeGb: 25,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('OS image not downloaded yet');
  });

  it('creates VM and persists config on success', async () => {
    const mockCreateVM = vi.fn().mockResolvedValue({ success: true });

    (vmManager as any).backend = { createVM: mockCreateVM };
    (vmManager as any).imageRegistry = {
      getImagePath: vi.fn().mockReturnValue('/path/to/ubuntu.iso'),
      getAvailableCatalog: vi.fn().mockReturnValue([
        { id: 'ubuntu-24', name: 'Ubuntu 24.04', vboxOsType: 'Ubuntu_64' },
      ]),
    };

    const result = await vmManager.createVM('TestVM', 'ubuntu-24', {
      cpuCount: 2,
      memoryMb: 4096,
      diskSizeGb: 25,
    });

    expect(result.success).toBe(true);
    expect(result.vmId).toBe('mock-uuid-1234');

    // Backend should be called with correct config
    expect(mockCreateVM).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'mock-uuid-1234',
        name: 'TestVM',
        backendVmId: 'Ubuntu_64',
      }),
      '/path/to/ubuntu.iso',
    );

    // Config should be persisted
    expect(vmConfigStore.addVM).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'mock-uuid-1234',
        name: 'TestVM',
      }),
    );
  });

  it('does not persist config on backend failure', async () => {
    const mockCreateVM = vi.fn().mockResolvedValue({
      success: false,
      error: 'VBoxManage failed',
    });

    (vmManager as any).backend = { createVM: mockCreateVM };
    (vmManager as any).imageRegistry = {
      getImagePath: vi.fn().mockReturnValue('/path/to/ubuntu.iso'),
      getAvailableCatalog: vi.fn().mockReturnValue([]),
    };

    const result = await vmManager.createVM('TestVM', 'image-id', {
      cpuCount: 2,
      memoryMb: 4096,
      diskSizeGb: 25,
    });

    expect(result.success).toBe(false);
    expect(vmConfigStore.addVM).not.toHaveBeenCalled();
  });

  it('defaults to Linux_64 when image not in catalog', async () => {
    const mockCreateVM = vi.fn().mockResolvedValue({ success: true });

    (vmManager as any).backend = { createVM: mockCreateVM };
    (vmManager as any).imageRegistry = {
      getImagePath: vi.fn().mockReturnValue('/path/to/custom.iso'),
      getAvailableCatalog: vi.fn().mockReturnValue([]), // empty catalog
    };

    await vmManager.createVM('CustomVM', 'custom-123', {
      cpuCount: 1,
      memoryMb: 2048,
      diskSizeGb: 20,
    });

    expect(mockCreateVM).toHaveBeenCalledWith(
      expect.objectContaining({
        backendVmId: 'Linux_64', // default fallback
      }),
      '/path/to/custom.iso',
    );
  });
});
