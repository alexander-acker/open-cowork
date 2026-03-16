/**
 * ComputerUseProvider — shared interface for desktop automation adapters.
 * Both ComputerUseAdapter (VBoxManage/VM) and LocalDesktopAdapter (nut.js/host)
 * implement this interface. ComputerUseSession accepts any provider.
 */

export interface ComputerUseAction {
  action:
    | 'screenshot'
    | 'click'
    | 'double_click'
    | 'triple_click'
    | 'type'
    | 'key'
    | 'scroll'
    | 'cursor_position'
    | 'wait'
    | 'drag';
  coordinate?: [number, number];
  text?: string;
  key?: string;
  delta_x?: number;
  delta_y?: number;
  duration?: number;
  start_coordinate?: [number, number];
  end_coordinate?: [number, number];
}

export interface ComputerUseResult {
  type: 'screenshot' | 'coordinate' | 'error';
  base64Image?: string;
  coordinate?: [number, number];
  error?: string;
}

export interface ComputerUseProvider {
  getDisplaySize(): { width: number; height: number };
  execute(action: ComputerUseAction): Promise<ComputerUseResult>;
}
