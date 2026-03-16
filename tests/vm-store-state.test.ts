import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../src/renderer/store';

// Reset store state between tests
beforeEach(() => {
  useAppStore.setState({
    naviAgentWorkingVMs: new Set<string>(),
    interactiveModeVMs: new Set<string>(),
    latestVMScreenshots: new Map<string, string>(),
  });
});

describe('naviAgentWorkingVMs', () => {
  it('initialises as an empty Set', () => {
    const { naviAgentWorkingVMs } = useAppStore.getState();
    expect(naviAgentWorkingVMs).toBeInstanceOf(Set);
    expect(naviAgentWorkingVMs.size).toBe(0);
  });

  it('setNaviAgentWorking(true) adds the vmId', () => {
    useAppStore.getState().setNaviAgentWorking('vm-1', true);
    expect(useAppStore.getState().naviAgentWorkingVMs.has('vm-1')).toBe(true);
  });

  it('setNaviAgentWorking(false) removes the vmId', () => {
    useAppStore.getState().setNaviAgentWorking('vm-1', true);
    useAppStore.getState().setNaviAgentWorking('vm-1', false);
    expect(useAppStore.getState().naviAgentWorkingVMs.has('vm-1')).toBe(false);
  });

  it('tracks multiple VMs independently', () => {
    useAppStore.getState().setNaviAgentWorking('vm-a', true);
    useAppStore.getState().setNaviAgentWorking('vm-b', true);
    useAppStore.getState().setNaviAgentWorking('vm-a', false);
    const { naviAgentWorkingVMs } = useAppStore.getState();
    expect(naviAgentWorkingVMs.has('vm-a')).toBe(false);
    expect(naviAgentWorkingVMs.has('vm-b')).toBe(true);
  });

  it('produces a new Set reference on each update', () => {
    const before = useAppStore.getState().naviAgentWorkingVMs;
    useAppStore.getState().setNaviAgentWorking('vm-1', true);
    const after = useAppStore.getState().naviAgentWorkingVMs;
    expect(after).not.toBe(before);
  });
});

describe('interactiveModeVMs', () => {
  it('initialises as an empty Set', () => {
    const { interactiveModeVMs } = useAppStore.getState();
    expect(interactiveModeVMs).toBeInstanceOf(Set);
    expect(interactiveModeVMs.size).toBe(0);
  });

  it('setInteractiveMode(true) adds the vmId', () => {
    useAppStore.getState().setInteractiveMode('vm-1', true);
    expect(useAppStore.getState().interactiveModeVMs.has('vm-1')).toBe(true);
  });

  it('setInteractiveMode(false) removes the vmId', () => {
    useAppStore.getState().setInteractiveMode('vm-1', true);
    useAppStore.getState().setInteractiveMode('vm-1', false);
    expect(useAppStore.getState().interactiveModeVMs.has('vm-1')).toBe(false);
  });

  it('tracks multiple VMs independently', () => {
    useAppStore.getState().setInteractiveMode('vm-x', true);
    useAppStore.getState().setInteractiveMode('vm-y', true);
    useAppStore.getState().setInteractiveMode('vm-x', false);
    const { interactiveModeVMs } = useAppStore.getState();
    expect(interactiveModeVMs.has('vm-x')).toBe(false);
    expect(interactiveModeVMs.has('vm-y')).toBe(true);
  });

  it('produces a new Set reference on each update', () => {
    const before = useAppStore.getState().interactiveModeVMs;
    useAppStore.getState().setInteractiveMode('vm-1', true);
    const after = useAppStore.getState().interactiveModeVMs;
    expect(after).not.toBe(before);
  });
});

describe('latestVMScreenshots', () => {
  it('initialises as an empty Map', () => {
    const { latestVMScreenshots } = useAppStore.getState();
    expect(latestVMScreenshots).toBeInstanceOf(Map);
    expect(latestVMScreenshots.size).toBe(0);
  });

  it('setVMScreenshot stores base64 data keyed by vmId', () => {
    useAppStore.getState().setVMScreenshot('vm-1', 'abc123==');
    expect(useAppStore.getState().latestVMScreenshots.get('vm-1')).toBe('abc123==');
  });

  it('overwrites previous screenshot for the same vmId', () => {
    useAppStore.getState().setVMScreenshot('vm-1', 'first');
    useAppStore.getState().setVMScreenshot('vm-1', 'second');
    expect(useAppStore.getState().latestVMScreenshots.get('vm-1')).toBe('second');
  });

  it('stores screenshots for multiple VMs without interference', () => {
    useAppStore.getState().setVMScreenshot('vm-a', 'data-a');
    useAppStore.getState().setVMScreenshot('vm-b', 'data-b');
    const { latestVMScreenshots } = useAppStore.getState();
    expect(latestVMScreenshots.get('vm-a')).toBe('data-a');
    expect(latestVMScreenshots.get('vm-b')).toBe('data-b');
  });

  it('produces a new Map reference on each update', () => {
    const before = useAppStore.getState().latestVMScreenshots;
    useAppStore.getState().setVMScreenshot('vm-1', 'data');
    const after = useAppStore.getState().latestVMScreenshots;
    expect(after).not.toBe(before);
  });
});
