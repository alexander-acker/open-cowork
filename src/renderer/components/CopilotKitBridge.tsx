import { useCopilotReadable, useCopilotAction } from '@copilotkit/react-core';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';

/**
 * CopilotKit Bridge Component
 *
 * Invisible component that wires up the Open Cowork agent system
 * to CopilotKit via useCopilotReadable and useCopilotAction hooks.
 * This gives the CopilotKit sidebar full awareness of the app state
 * and the ability to create/manage agent sessions.
 */
export function CopilotKitBridge() {
  const {
    sessions,
    activeSessionId,
    messagesBySession,
    appConfig,
    workingDir,
    isConfigured,
  } = useAppStore();
  const { startSession, continueSession, stopSession } = useIPC();

  // Expose current sessions to the copilot
  useCopilotReadable({
    description: 'List of all agent sessions in Open Cowork',
    value: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      cwd: s.cwd,
      createdAt: new Date(s.createdAt).toISOString(),
    })),
  });

  // Expose the active session and its recent messages
  useCopilotReadable({
    description: 'Currently active session and its recent messages',
    value: activeSessionId
      ? {
          sessionId: activeSessionId,
          session: sessions.find((s) => s.id === activeSessionId),
          recentMessages: (messagesBySession[activeSessionId] || [])
            .slice(-10)
            .map((m) => ({
              role: m.role,
              content: m.content
                .filter((c) => c.type === 'text')
                .map((c) => ('text' in c ? c.text : ''))
                .join('\n'),
              timestamp: new Date(m.timestamp).toISOString(),
            })),
        }
      : null,
  });

  // Expose app configuration
  useCopilotReadable({
    description: 'Application configuration including AI provider and model',
    value: {
      isConfigured,
      provider: appConfig?.provider,
      model: appConfig?.model,
      workingDir,
    },
  });

  // Action: Start a new agent session
  useCopilotAction({
    name: 'startAgentSession',
    description:
      'Start a new AI agent session in Open Cowork. Use this when the user wants to begin a new task or conversation with the AI agent.',
    parameters: [
      {
        name: 'title',
        type: 'string',
        description: 'A short title for the session',
        required: true,
      },
      {
        name: 'prompt',
        type: 'string',
        description: 'The initial prompt/task to send to the agent',
        required: true,
      },
    ],
    handler: async ({ title, prompt }: { title: string; prompt: string }) => {
      const session = await startSession(title, prompt, workingDir || undefined);
      return `Started session "${title}" (ID: ${session?.id})`;
    },
  });

  // Action: Send a message to the active session
  useCopilotAction({
    name: 'sendMessageToAgent',
    description:
      'Send a follow-up message to the currently active agent session. Use this to continue a conversation or provide additional instructions.',
    parameters: [
      {
        name: 'message',
        type: 'string',
        description: 'The message to send to the agent',
        required: true,
      },
    ],
    handler: async ({ message }: { message: string }) => {
      if (!activeSessionId) {
        return 'No active session. Please start a new session first.';
      }
      await continueSession(activeSessionId, [{ type: 'text', text: message }]);
      return `Message sent to session ${activeSessionId}`;
    },
  });

  // Action: Stop the active agent session
  useCopilotAction({
    name: 'stopAgentSession',
    description:
      'Stop the currently running agent session. Use this when the user wants to interrupt or cancel the current task.',
    parameters: [],
    handler: async () => {
      if (!activeSessionId) {
        return 'No active session to stop.';
      }
      stopSession(activeSessionId);
      return `Stopped session ${activeSessionId}`;
    },
  });

  // Action: Switch to a different session
  useCopilotAction({
    name: 'switchSession',
    description:
      'Switch to a different existing session by its ID. Use this when the user wants to revisit a previous conversation.',
    parameters: [
      {
        name: 'sessionId',
        type: 'string',
        description: 'The ID of the session to switch to',
        required: true,
      },
    ],
    handler: async ({ sessionId }: { sessionId: string }) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) {
        return `Session ${sessionId} not found.`;
      }
      useAppStore.getState().setActiveSession(sessionId);
      return `Switched to session "${session.title}"`;
    },
  });

  // Action: Get summary of current session messages
  useCopilotAction({
    name: 'getSessionSummary',
    description:
      'Get a summary of all messages in the currently active session. Useful for understanding the context of an ongoing conversation.',
    parameters: [],
    handler: async () => {
      if (!activeSessionId) {
        return 'No active session.';
      }
      const messages = messagesBySession[activeSessionId] || [];
      const summary = messages
        .filter((m) => m.content.some((c) => c.type === 'text'))
        .map((m) => {
          const text = m.content
            .filter((c) => c.type === 'text')
            .map((c) => ('text' in c ? c.text : ''))
            .join('\n');
          return `[${m.role}]: ${text.slice(0, 200)}${text.length > 200 ? '...' : ''}`;
        })
        .join('\n\n');
      return summary || 'No messages in this session.';
    },
  });

  // This component renders nothing - it only sets up hooks
  return null;
}
