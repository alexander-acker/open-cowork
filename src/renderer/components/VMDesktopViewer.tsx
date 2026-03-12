/**
 * VMDesktopViewer - Embeds a noVNC viewer for a running VirtualBox VM
 *
 * Connects to a WebSocket proxy that bridges to the VM's VRDE/VNC port.
 * Used inside CoworkDesktopView for the embedded co-working experience.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { VncScreen } from 'react-vnc';
import { Monitor, Maximize2, Minimize2, RefreshCw } from 'lucide-react';

interface VMDesktopViewerProps {
  wsUrl: string;
  vmId: string;
  vmName: string;
  viewOnly?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  className?: string;
  isAgentWorking?: boolean;   // Show blue haze overlay
  isInteractive?: boolean;    // User has keyboard/mouse access
  onStopAgent?: () => void;   // Stop button callback
}

export function VMDesktopViewer({
  wsUrl,
  vmId,
  vmName,
  viewOnly: _viewOnly = false,
  onConnect,
  onDisconnect,
  className = '',
  isAgentWorking = false,
  isInteractive = false,
  onStopAgent,
}: VMDesktopViewerProps) {
  const vncRef = useRef<any>(null);
  const [connected, setConnected] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Inject navi-haze CSS keyframes once
  useEffect(() => {
    if (!document.getElementById('navi-haze-styles')) {
      const style = document.createElement('style');
      style.id = 'navi-haze-styles';
      style.textContent = `
        @keyframes navi-haze {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Esc key handler for interactive mode
  useEffect(() => {
    if (!isInteractive) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const api = (window as any).electronAPI;
        api?.vm?.disableInteractiveMode(vmId);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isInteractive, vmId]);

  // 3-minute inactivity auto-disable for interactive mode
  useEffect(() => {
    if (!isInteractive) return;
    let lastActivity = Date.now();
    const TIMEOUT_MS = 3 * 60 * 1000;

    const activityHandler = () => { lastActivity = Date.now(); };
    const checkTimer = setInterval(() => {
      if (Date.now() - lastActivity > TIMEOUT_MS) {
        const api = (window as any).electronAPI;
        api?.vm?.disableInteractiveMode(vmId);
      }
    }, 10000);

    const container = containerRef.current;
    container?.addEventListener('keydown', activityHandler);
    container?.addEventListener('mousemove', activityHandler);
    container?.addEventListener('click', activityHandler);

    return () => {
      clearInterval(checkTimer);
      container?.removeEventListener('keydown', activityHandler);
      container?.removeEventListener('mousemove', activityHandler);
      container?.removeEventListener('click', activityHandler);
    };
  }, [isInteractive, vmId]);

  const handleConnect = useCallback(() => {
    setConnected(true);
    onConnect?.();
  }, [onConnect]);

  const handleDisconnect = useCallback(() => {
    setConnected(false);
    onDisconnect?.();
  }, [onDisconnect]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!fullscreen) {
      containerRef.current.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    setFullscreen(!fullscreen);
  }, [fullscreen]);

  // Listen for fullscreen changes
  useEffect(() => {
    const handler = () => {
      setFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col rounded-xl overflow-hidden border border-border bg-black ${className}`}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface border-b border-border z-10">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-accent" />
          <span className="text-xs font-medium text-text-primary">{vmName}</span>
          <span
            className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}
            title={connected ? 'Connected' : 'Disconnected'}
          />
          {!connected && (
            <span className="text-xs text-text-muted">Connecting...</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleFullscreen}
            className="p-1 hover:bg-surface-hover rounded transition-colors"
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? (
              <Minimize2 className="w-3.5 h-3.5 text-text-secondary" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5 text-text-secondary" />
            )}
          </button>
        </div>
      </div>

      {/* VNC Canvas */}
      <div className="flex-1 relative">
        <VncScreen
          url={wsUrl}
          scaleViewport
          clipViewport={false}
          resizeSession={false}
          viewOnly={!isInteractive}
          background="#000000"
          style={{ width: '100%', height: '100%' }}
          ref={vncRef}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          retryDuration={3000}
          debug={false}
        />

        {/* Blue haze overlay when Navi is working */}
        {isAgentWorking && (
          <div
            className="absolute inset-0 pointer-events-none transition-opacity duration-300"
            style={{
              background: 'rgba(59, 130, 246, 0.12)',
              animation: 'navi-haze 2s ease-in-out infinite',
              boxShadow: 'inset 0 0 40px rgba(59, 130, 246, 0.15)',
            }}
          />
        )}

        {/* Status pill */}
        {isAgentWorking && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2 rounded-full bg-surface border border-border shadow-lg">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: 'rgb(59, 130, 246)', animation: 'pulse 1.5s ease-in-out infinite' }}
            />
            <span className="text-xs font-medium text-text-primary">Navi is working...</span>
            <button
              onClick={onStopAgent}
              className="ml-1 px-2 py-0.5 rounded-md text-xs font-medium text-red-500 hover:bg-red-500/10 transition-colors pointer-events-auto"
            >
              Stop
            </button>
          </div>
        )}

        {/* Disconnected overlay */}
        {!connected && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <div className="flex flex-col items-center gap-3 text-text-muted">
              <RefreshCw className="w-8 h-8 animate-spin" />
              <span className="text-sm">Connecting to VM display...</span>
            </div>
          </div>
        )}

        {/* Interactive mode banner */}
        {isInteractive && (
          <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-center gap-2 px-4 py-2 text-black text-xs font-medium"
            style={{ backgroundColor: 'rgba(234, 179, 8, 0.9)' }}
          >
            You have keyboard control — press Esc to release
          </div>
        )}
      </div>
    </div>
  );
}
