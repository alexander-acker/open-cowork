import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
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
    getImageCachePath: vi.fn().mockReturnValue(null),
  },
}));

import { VMImageRegistry } from '../../src/main/vm/vm-image-registry';

describe('VMImageRegistry', () => {
  let registry: VMImageRegistry;
  let tempDir: string;
  let tempIso: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-test-'));
    tempIso = path.join(tempDir, 'test-distro.iso');
    fs.writeFileSync(tempIso, 'fake ISO content for testing');

    registry = new VMImageRegistry();
    // Override the cache dir to use our temp directory
    (registry as any).imageCacheDir = tempDir;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('imports ISO and registers with clean name', async () => {
    const image = await registry.importISO(tempIso, 'Zorin-OS-18-Pro-64-bit');

    expect(image.id).toMatch(/^custom-\d+$/);
    expect(image.name).toBe('Zorin-OS-18-Pro-64-bit');
    expect(image.distro).toBe('custom');
    expect(image.vboxOsType).toBe('Linux_64');
    expect(image.fileSize).toBeGreaterThan(0);
  });

  it('copies ISO into cache directory', async () => {
    const image = await registry.importISO(tempIso, 'TestOS');

    const cachedPath = path.join(tempDir, `${image.id}.iso`);
    expect(fs.existsSync(cachedPath)).toBe(true);
  });

  it('getImagePath returns cached path for imported image', async () => {
    const image = await registry.importISO(tempIso, 'TestOS');

    const retrievedPath = registry.getImagePath(image.id);
    expect(retrievedPath).toBeTruthy();
    expect(retrievedPath).toContain(image.id);
  });

  it('getImagePath returns null for unknown ID', () => {
    const result = registry.getImagePath('nonexistent-id');
    expect(result).toBeNull();
  });

  it('isDownloaded returns true for imported image', async () => {
    const image = await registry.importISO(tempIso, 'TestOS');
    expect(registry.isDownloaded(image.id)).toBe(true);
  });

  it('isDownloaded returns false for unknown ID', () => {
    expect(registry.isDownloaded('nonexistent-id')).toBe(false);
  });

  it('imported image appears in available catalog', async () => {
    const image = await registry.importISO(tempIso, 'MyCustomOS');

    const catalog = registry.getAvailableCatalog();
    const found = catalog.find(i => i.id === image.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('MyCustomOS');
  });

  it('imported image appears in downloaded images', async () => {
    const image = await registry.importISO(tempIso, 'MyCustomOS');

    const downloaded = registry.getDownloadedImages();
    const found = downloaded.find(i => i.id === image.id);
    expect(found).toBeDefined();
  });
});
