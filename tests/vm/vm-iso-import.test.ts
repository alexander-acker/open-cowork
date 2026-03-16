import { describe, it, expect } from 'vitest';

/**
 * Tests for ISO filename sanitization logic used in vm.handlers.ts
 * (extracted to pure functions for testability)
 */

function stripIsoExtension(rawName: string): string {
  return rawName.replace(/\.iso$/i, '') || 'Custom ISO';
}

describe('ISO filename sanitization', () => {
  it('strips .iso extension', () => {
    expect(stripIsoExtension('Zorin-OS-18-Pro-64-bit.iso')).toBe('Zorin-OS-18-Pro-64-bit');
  });

  it('strips .ISO extension (case insensitive)', () => {
    expect(stripIsoExtension('ubuntu-24.04.2-desktop-amd64.ISO')).toBe('ubuntu-24.04.2-desktop-amd64');
  });

  it('strips .Iso extension (mixed case)', () => {
    expect(stripIsoExtension('LinuxMint-22.Iso')).toBe('LinuxMint-22');
  });

  it('does not strip .iso from middle of name', () => {
    expect(stripIsoExtension('my.isotope-test.iso')).toBe('my.isotope-test');
  });

  it('handles name with no extension', () => {
    expect(stripIsoExtension('ubuntu-server')).toBe('ubuntu-server');
  });

  it('handles filename that is just .iso', () => {
    // .iso stripped leaves empty string, fallback to Custom ISO
    expect(stripIsoExtension('.iso')).toBe('Custom ISO');
  });

  it('preserves names with parentheses (validation catches later)', () => {
    expect(stripIsoExtension('Zorin-OS-18-Pro-64-bit (1).iso')).toBe('Zorin-OS-18-Pro-64-bit (1)');
  });

  it('handles double extension .tar.iso', () => {
    expect(stripIsoExtension('backup.tar.iso')).toBe('backup.tar');
  });
});

describe('VM name from ISO filename edge cases', () => {
  // Simulates the full flow: filename extraction + strip + validation regex
  const VM_NAME_REGEX = /^[a-zA-Z0-9 ._-]+$/;

  function wouldPassValidation(isoFilename: string): boolean {
    const name = stripIsoExtension(isoFilename);
    return VM_NAME_REGEX.test(name) && name.length > 0 && name.length <= 255;
  }

  it('Zorin ISO passes after stripping', () => {
    expect(wouldPassValidation('Zorin-OS-18-Pro-64-bit.iso')).toBe(true);
  });

  it('Ubuntu with version dots passes', () => {
    expect(wouldPassValidation('ubuntu-24.04.2-desktop-amd64.iso')).toBe(true);
  });

  it('Linux Mint passes', () => {
    expect(wouldPassValidation('linuxmint-22-cinnamon-64bit.iso')).toBe(true);
  });

  it('Fedora passes', () => {
    expect(wouldPassValidation('Fedora-Workstation-Live-x86_64-41.iso')).toBe(true);
  });

  it('ISO with copy suffix (1) fails validation (parentheses)', () => {
    expect(wouldPassValidation('Zorin-OS-18-Pro-64-bit (1).iso')).toBe(false);
  });
});
