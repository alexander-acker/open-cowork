import { useEffect, useRef, useCallback } from 'react';
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
import { OnboardingModal } from './components/OnboardingModal';
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
    showOnboardingModal,
    setShowConfigModal,
    setIsConfigured,
    setAppConfig,
    setSandboxSetupComplete,
    setWorkEnvironment,
    setShowOnboardingModal,
  } = useAppStore();
  const { listSessions, isElectron } = useIPC();
  const initialized = useRef(false);

  useEffect(() => {
    // Only run once on mount
    if (initialized.current) return;
    initialized.current = true;

    if (isElectron) {
      listSessions();
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

  // Check onboarding state
  useEffect(() => {
    if (!isConfigured || !isElectronEnv) return;

    window.electronAPI.onboarding.getWorkEnvironment().then((env) => {
      if (env === null) {
        setShowOnboardingModal(true);
      } else {
        setWorkEnvironment(env);
      }
    });
  }, [isConfigured, setShowOnboardingModal, setWorkEnvironment]);

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

  return (
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
      
      {/* Onboarding Modal */}
      {showOnboardingModal && (
        <OnboardingModal onComplete={() => setShowOnboardingModal(false)} />
      )}

      {/* AskUserQuestion is now rendered inline in MessageCard */}
    </div>
  );
}

export default App;
