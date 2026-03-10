/**
 * LocalDesktopAdapter — Computer Use adapter for the host machine.
 * Uses @nut-tree-fork/nut-js to capture screenshots and control mouse/keyboard
 * on the user's real desktop (not a VM).
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { log, logError } from '../utils/logger';
import type {
  ComputerUseAction,
  ComputerUseResult,
  ComputerUseProvider,
} from './computer-use-provider';

let nutModule: typeof import('@nut-tree-fork/nut-js') | null = null;

async function getNut() {
  if (!nutModule) {
    nutModule = await import('@nut-tree-fork/nut-js');
  }
  return nutModule;
}

export class LocalDesktopAdapter implements ComputerUseProvider {
  private displayWidth = 1920;
  private displayHeight = 1080;
  private screenshotDir: string;
  private lastCursorPos: [number, number] = [0, 0];
  private initialized = false;

  constructor() {
    this.screenshotDir = path.join(app.getPath('userData'), 'desktop-screenshots');
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true });
    }
  }

  private async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const nut = await getNut();
      this.displayWidth = await nut.screen.width();
      this.displayHeight = await nut.screen.height();
      this.initialized = true;
      log(
        '[LocalDesktop] Initialized. Display:',
        this.displayWidth,
        'x',
        this.displayHeight
      );
    } catch (err) {
      logError('[LocalDesktop] Failed to detect display size:', err);
    }
  }

  getDisplaySize(): { width: number; height: number } {
    return { width: this.displayWidth, height: this.displayHeight };
  }

  async execute(action: ComputerUseAction): Promise<ComputerUseResult> {
    await this.init();
    try {
      switch (action.action) {
        case 'screenshot':
          return this.takeScreenshot();
        case 'click':
          return this.click(action.coordinate!);
        case 'double_click':
          return this.doubleClick(action.coordinate!);
        case 'triple_click':
          return this.tripleClick(action.coordinate!);
        case 'type':
          return this.typeText(action.text!);
        case 'key':
          return this.sendKey(action.key!);
        case 'scroll':
          return this.scroll(
            action.coordinate || this.lastCursorPos,
            action.delta_x ?? 0,
            action.delta_y ?? 0
          );
        case 'cursor_position':
          return this.getCursorPosition();
        case 'wait':
          return this.wait(action.duration ?? 2);
        case 'drag':
          return this.drag(action.start_coordinate!, action.end_coordinate!);
        default:
          return {
            type: 'error',
            error: `Unknown action: ${(action as any).action}`,
          };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('[LocalDesktop] Action failed:', action.action, msg);
      return { type: 'error', error: msg };
    }
  }

  private async takeScreenshot(): Promise<ComputerUseResult> {
    const nut = await getNut();
    const screenshotPath = path.join(
      this.screenshotDir,
      `desktop-${Date.now()}.png`
    );
    try {
      // nut-js v4: grab screen region and save to file
      await nut.screen.capture(screenshotPath);
      const buffer = fs.readFileSync(screenshotPath);
      const base64 = buffer.toString('base64');
      try {
        fs.unlinkSync(screenshotPath);
      } catch {
        /* ignore cleanup errors */
      }
      return { type: 'screenshot', base64Image: base64 };
    } catch (err) {
      // Fallback: try alternative capture method
      try {
        const image = await nut.screen.grab();
        // If grab returns an Image object, try to get raw data
        if (image && typeof (image as any).toRGB === 'function') {
          return {
            type: 'error',
            error: `Screenshot capture requires file-based method. Error: ${err}`,
          };
        }
        return { type: 'error', error: `Screenshot failed: ${err}` };
      } catch (fallbackErr) {
        return { type: 'error', error: `Screenshot failed: ${err}` };
      }
    }
  }

  private async click(coordinate: [number, number]): Promise<ComputerUseResult> {
    const nut = await getNut();
    this.lastCursorPos = coordinate;
    const [x, y] = coordinate;
    log('[LocalDesktop] Click at', x, y);
    await nut.mouse.setPosition({ x, y });
    await nut.mouse.click(nut.Button.LEFT);
    return this.takeScreenshot();
  }

  private async doubleClick(
    coordinate: [number, number]
  ): Promise<ComputerUseResult> {
    const nut = await getNut();
    this.lastCursorPos = coordinate;
    const [x, y] = coordinate;
    log('[LocalDesktop] Double click at', x, y);
    await nut.mouse.setPosition({ x, y });
    await nut.mouse.doubleClick(nut.Button.LEFT);
    return this.takeScreenshot();
  }

  private async tripleClick(
    coordinate: [number, number]
  ): Promise<ComputerUseResult> {
    const nut = await getNut();
    this.lastCursorPos = coordinate;
    const [x, y] = coordinate;
    log('[LocalDesktop] Triple click at', x, y);
    await nut.mouse.setPosition({ x, y });
    await nut.mouse.click(nut.Button.LEFT);
    await new Promise((r) => setTimeout(r, 50));
    await nut.mouse.click(nut.Button.LEFT);
    await new Promise((r) => setTimeout(r, 50));
    await nut.mouse.click(nut.Button.LEFT);
    return this.takeScreenshot();
  }

  private async typeText(text: string): Promise<ComputerUseResult> {
    const nut = await getNut();
    log(
      '[LocalDesktop] Type text:',
      text.substring(0, 50) + (text.length > 50 ? '...' : '')
    );
    await nut.keyboard.type(text);
    return this.takeScreenshot();
  }

  private async sendKey(key: string): Promise<ComputerUseResult> {
    const nut = await getNut();
    log('[LocalDesktop] Send key:', key);
    const parts = key.split('+').map((k) => k.trim().toLowerCase());

    const keyMap: Record<string, number> = {
      ctrl: nut.Key.LeftControl,
      control: nut.Key.LeftControl,
      alt: nut.Key.LeftAlt,
      shift: nut.Key.LeftShift,
      super: nut.Key.LeftSuper,
      cmd: nut.Key.LeftSuper,
      meta: nut.Key.LeftSuper,
      enter: nut.Key.Enter,
      return: nut.Key.Enter,
      tab: nut.Key.Tab,
      escape: nut.Key.Escape,
      esc: nut.Key.Escape,
      backspace: nut.Key.Backspace,
      delete: nut.Key.Delete,
      del: nut.Key.Delete,
      space: nut.Key.Space,
      up: nut.Key.Up,
      down: nut.Key.Down,
      left: nut.Key.Left,
      right: nut.Key.Right,
      home: nut.Key.Home,
      end: nut.Key.End,
      pageup: nut.Key.PageUp,
      pagedown: nut.Key.PageDown,
      f1: nut.Key.F1,
      f2: nut.Key.F2,
      f3: nut.Key.F3,
      f4: nut.Key.F4,
      f5: nut.Key.F5,
      f6: nut.Key.F6,
      f7: nut.Key.F7,
      f8: nut.Key.F8,
      f9: nut.Key.F9,
      f10: nut.Key.F10,
      f11: nut.Key.F11,
      f12: nut.Key.F12,
    };

    const resolveKey = (k: string): number => {
      if (keyMap[k]) return keyMap[k];
      if (k.length === 1) {
        const upper = k.toUpperCase();
        const keyEnum = (nut.Key as any)[upper];
        if (keyEnum !== undefined) return keyEnum;
      }
      return keyMap['space']; // fallback
    };

    const keys = parts.map(resolveKey);
    await nut.keyboard.pressKey(...keys);
    await nut.keyboard.releaseKey(...keys.reverse());
    return this.takeScreenshot();
  }

  private async scroll(
    coordinate: [number, number],
    deltaX: number,
    deltaY: number
  ): Promise<ComputerUseResult> {
    const nut = await getNut();
    this.lastCursorPos = coordinate;
    const [x, y] = coordinate;
    log('[LocalDesktop] Scroll at', x, y, 'delta:', deltaX, deltaY);
    await nut.mouse.setPosition({ x, y });
    if (deltaY > 0)
      await nut.mouse.scrollDown(Math.abs(Math.round(deltaY / 3)) || 1);
    if (deltaY < 0)
      await nut.mouse.scrollUp(Math.abs(Math.round(deltaY / 3)) || 1);
    if (deltaX > 0)
      await nut.mouse.scrollRight(Math.abs(Math.round(deltaX / 3)) || 1);
    if (deltaX < 0)
      await nut.mouse.scrollLeft(Math.abs(Math.round(deltaX / 3)) || 1);
    return this.takeScreenshot();
  }

  private async getCursorPosition(): Promise<ComputerUseResult> {
    const nut = await getNut();
    const pos = await nut.mouse.getPosition();
    this.lastCursorPos = [pos.x, pos.y];
    return { type: 'coordinate', coordinate: [pos.x, pos.y] };
  }

  private async wait(durationSeconds: number): Promise<ComputerUseResult> {
    log('[LocalDesktop] Waiting', durationSeconds, 'seconds');
    await new Promise((r) => setTimeout(r, durationSeconds * 1000));
    return this.takeScreenshot();
  }

  private async drag(
    start: [number, number],
    end: [number, number]
  ): Promise<ComputerUseResult> {
    const nut = await getNut();
    log('[LocalDesktop] Drag from', start, 'to', end);
    this.lastCursorPos = end;
    await nut.mouse.setPosition({ x: start[0], y: start[1] });
    await nut.mouse.pressButton(nut.Button.LEFT);
    await nut.mouse.setPosition({ x: end[0], y: end[1] });
    await nut.mouse.releaseButton(nut.Button.LEFT);
    return this.takeScreenshot();
  }
}
