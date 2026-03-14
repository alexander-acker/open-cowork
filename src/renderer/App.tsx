import { useEffect, useRef, useCallback, useState } from 'react';
import { useAppStore } from './store';
import { useIPC } from './hooks/useIPC';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { WelcomeView } from './components/WelcomeView';
import { PermissionDialog } from './components/PermissionDialog';
import { ContextPanel } from './components/ContextPanel';
import { ConfigModal } from './components/ConfigModal';
import { Titlebar } from './components/Titlebar';
import { SandboxSetupDialog } from './components/SandboxSetupDialog';
import { SandboxSyncToast } from './components/SandboxSyncToast';
import { CopilotKitBridge } from './components/CopilotKitBridge';
import { CopilotKit } from '@copilotkit/react-core';
import { CopilotSidebar } from '@copilotkit/react-ui';
import type { AppConfig } from './types';

// Check if running in Electron
const isElectronEnv = typeof window !== 'undefined' && window.electronAPI !== undefined;

function App() {
  const { 
    activeSessionId, 
    pendingPermission,
    settings,
    showConfigModal,
    isConfigured,
    appConfig,
    sandboxSetupProgress,
    isSandboxSetupComplete,
    sandboxSyncStatus,
    setShowConfigModal,
    setIsConfigured,
    setAppConfig,
    setSandboxSetupComplete,
  } = useAppStore();
  const { listSessions, isElectron } = useIPC();
  const initialized = useRef(false);
  const [copilotKitUrl, setCopilotKitUrl] = useState<string | null>(null);

  useEffect(() => {
    // Only run once on mount
    if (initialized.current) return;
    initialized.current = true;

    if (isElectron) {
      listSessions();
      // Fetch CopilotKit runtime URL
      window.electronAPI.copilotkit.getRuntimeUrl().then((url) => {
        if (url) {
          console.log('[App] CopilotKit runtime URL:', url);
          setCopilotKitUrl(url);
        }
      }).catch((err) => {
        console.warn('[App] Failed to get CopilotKit runtime URL:', err);
      });
    }
  }, []); // Empty deps - run once

  // Apply theme to document root
  useEffect(() => {
    if (settings.theme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
  }, [settings.theme]);

  // Handle config save
  const handleConfigSave = useCallback(async (newConfig: Partial<AppConfig>) => {
    if (!isElectronEnv) {
      console.log('[App] Browser mode - config save simulated');
      return;
    }
    
    const result = await window.electronAPI.config.save(newConfig);
    if (result.success) {
      setIsConfigured(true);
      setAppConfig(result.config);
    }
  }, [setIsConfigured, setAppConfig]);

  // Handle config modal close
  const handleConfigClose = useCallback(() => {
    setShowConfigModal(false);
  }, [setShowConfigModal]);

  // Handle sandbox setup complete
  const handleSandboxSetupComplete = useCallback(() => {
    setSandboxSetupComplete(true);
  }, [setSandboxSetupComplete]);

  // Determine if we should show the sandbox setup dialog
  // Show if there's progress and setup is not complete
  const showSandboxSetup = sandboxSetupProgress && !isSandboxSetupComplete;

  const appContent = (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background">
      {/* Titlebar - draggable region */}
      <Titlebar />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <Sidebar />

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col overflow-hidden bg-background">
          {activeSessionId ? <ChatView /> : <WelcomeView />}
        </main>

        {/* Context Panel - only show when in session */}
        {activeSessionId && <ContextPanel />}
      </div>

      {/* Permission Dialog */}
      {pendingPermission && <PermissionDialog permission={pendingPermission} />}

      {/* Config Modal */}
      <ConfigModal
        isOpen={showConfigModal}
        onClose={handleConfigClose}
        onSave={handleConfigSave}
        initialConfig={appConfig}
        isFirstRun={!isConfigured}
      />

      {/* Sandbox Setup Dialog */}
      {showSandboxSetup && (
        <SandboxSetupDialog
          progress={sandboxSetupProgress}
          onComplete={handleSandboxSetupComplete}
        />
      )}

      {/* Sandbox Sync Toast */}
      <SandboxSyncToast status={sandboxSyncStatus} />

      {/* AskUserQuestion is now rendered inline in MessageCard */}
    </div>
  );

  // Wrap with CopilotKit when runtime URL is available
  if (copilotKitUrl) {
    return (
      <CopilotKit runtimeUrl={copilotKitUrl}>
        <CopilotKitBridge />
        <CopilotSidebar
          labels={{
            title: 'Open Cowork Copilot',
            initial: 'Hi! I can help you manage your agent sessions, start new tasks, and provide context about your work. What would you like to do?',
            placeholder: 'Ask your copilot...',
          }}
          defaultOpen={false}
          clickOutsideToClose={true}
        >
          {appContent}
        </CopilotSidebar>
      </CopilotKit>
    );
  }

  return appContent;
}

export default App;
