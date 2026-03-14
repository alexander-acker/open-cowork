import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { buildNaviGraph } from './graph/navi-graph';
import type { NaviConfig, NaviResult, UserProfile } from './types';
import type { Session, Message, ServerEvent, TraceStep, ContentBlock } from '../../renderer/types';
import { v4 as uuidv4 } from 'uuid';
import { log, logError } from '../utils/logger';

/**
 * NaviRunner - Integrates the LangGraph career agent system into the Open Cowork app.
 *
 * Key design decisions to fix the original issues:
 * 1. NO separate LangGraph server — runs in-process, eliminating connection failures
 * 2. Token budget enforcement — max turns + max tokens per response + message trimming
 * 3. Deterministic tool routing — each agent has ONLY its own tools bound
 * 4. Single-pass execution — supervisor → specialist → done (no agent loops)
 */
export class NaviRunner {
  private config: NaviConfig;
  private graph: ReturnType<typeof buildNaviGraph> | null = null;
  private userProfile: UserProfile = {};
  private conversationHistory: Array<HumanMessage | AIMessage> = [];
  private sendToRenderer: (event: ServerEvent) => void;
  private saveMessage: (message: Message) => void;
  private activeSessions: Map<string, AbortController> = new Map();

  constructor(
    config: NaviConfig,
    callbacks: {
      sendToRenderer: (event: ServerEvent) => void;
      saveMessage: (message: Message) => void;
    }
  ) {
    this.config = config;
    this.sendToRenderer = callbacks.sendToRenderer;
    this.saveMessage = callbacks.saveMessage;
  }

  /**
   * Initialize the graph (lazy — only built on first use).
   */
  private ensureGraph() {
    if (!this.graph) {
      log('[Navi] Building agent graph...');
      this.graph = buildNaviGraph(this.config);
      log('[Navi] Agent graph ready');
    }
    return this.graph;
  }

  /**
   * Run a conversation turn through the Navi agent system.
   */
  async run(session: Session, prompt: string, existingMessages: Message[]): Promise<void> {
    const sessionId = session.id;
    const abortController = new AbortController();
    this.activeSessions.set(sessionId, abortController);

    try {
      const graph = this.ensureGraph();

      // Emit user message
      const userMessage: Message = {
        id: uuidv4(),
        sessionId,
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        timestamp: Date.now(),
      };
      this.saveMessage(userMessage);
      this.sendToRenderer({
        type: 'stream.message',
        payload: { sessionId, message: userMessage },
      });

      // Convert existing messages to LangChain format for context
      this.rebuildHistoryFromMessages(existingMessages);

      // Add the new user message
      this.conversationHistory.push(new HumanMessage(prompt));

      // Emit trace step for routing
      const routingStepId = uuidv4();
      this.emitTraceStep(sessionId, {
        id: routingStepId,
        type: 'tool_call',
        title: 'Navi: Routing to specialist...',
        status: 'running',
        timestamp: Date.now(),
      });

      // Update session status to running
      this.sendToRenderer({
        type: 'session.status',
        payload: { sessionId, status: 'running' },
      });

      // Invoke the graph
      const result = await graph.invoke({
        messages: this.conversationHistory,
        userProfile: this.userProfile,
        turnCount: 0,
        currentAgent: 'supervisor' as const,
        nextAgent: 'supervisor' as const,
      });

      // Check for abort
      if (abortController.signal.aborted) {
        log(`[Navi] Session ${sessionId} was cancelled`);
        return;
      }

      // Extract the response
      const naviResult = this.extractResult(result);

      // Update stored profile
      this.userProfile = naviResult.userProfile;

      // Update trace step
      this.emitTraceUpdate(sessionId, routingStepId, {
        title: `Navi: ${naviResult.respondingAgent} agent responded`,
        status: 'completed',
      });

      // Store the AI response in conversation history
      this.conversationHistory.push(new AIMessage(naviResult.response));

      // Trim conversation history to prevent unbounded growth
      if (this.conversationHistory.length > 20) {
        this.conversationHistory = this.conversationHistory.slice(-20);
      }

      // Emit the response as a message
      const assistantMessage: Message = {
        id: uuidv4(),
        sessionId,
        role: 'assistant',
        content: [{ type: 'text', text: naviResult.response }],
        timestamp: Date.now(),
      };
      this.saveMessage(assistantMessage);
      this.sendToRenderer({
        type: 'stream.message',
        payload: { sessionId, message: assistantMessage },
      });

      // Emit completion
      this.sendToRenderer({
        type: 'session.status',
        payload: { sessionId, status: 'idle' },
      });

    } catch (error: any) {
      logError(`[Navi] Error in session ${sessionId}:`, error);

      // Emit error trace
      this.emitTraceStep(sessionId, {
        id: uuidv4(),
        type: 'tool_result',
        title: `Navi Error: ${error.message?.slice(0, 100) || 'Unknown error'}`,
        status: 'error',
        isError: true,
        timestamp: Date.now(),
      });

      // Send error message to user
      const errorMessage: Message = {
        id: uuidv4(),
        sessionId,
        role: 'assistant',
        content: [{ type: 'text', text: `I encountered an issue processing your request. ${error.message || 'Please try again.'}` }],
        timestamp: Date.now(),
      };
      this.saveMessage(errorMessage);
      this.sendToRenderer({
        type: 'stream.message',
        payload: { sessionId, message: errorMessage },
      });

      this.sendToRenderer({
        type: 'session.status',
        payload: { sessionId, status: 'error', error: error.message },
      });

    } finally {
      this.activeSessions.delete(sessionId);
    }
  }

  /**
   * Cancel an active session.
   */
  cancel(sessionId: string): void {
    const controller = this.activeSessions.get(sessionId);
    if (controller) {
      controller.abort();
      this.activeSessions.delete(sessionId);
      log(`[Navi] Cancelled session ${sessionId}`);
    }
  }

  /**
   * Stub for compatibility with AgentRunner interface.
   */
  handleQuestionResponse(_questionId: string, _answer: string): void {
    // Navi agents don't use interactive questions — they use tools instead
  }

  /**
   * Reset the conversation state.
   */
  reset(): void {
    this.conversationHistory = [];
    this.userProfile = {};
    this.graph = null;
    log('[Navi] State reset');
  }

  /**
   * Get the current user profile.
   */
  getUserProfile(): UserProfile {
    return { ...this.userProfile };
  }

  /**
   * Update configuration (e.g., when API key changes).
   */
  updateConfig(newConfig: Partial<NaviConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.graph = null; // Force rebuild on next invocation
    log('[Navi] Config updated, graph will rebuild on next use');
  }

  // -- Private Helpers --

  private extractResult(graphResult: any): NaviResult {
    const messages = graphResult.messages || [];
    const lastAiMessage = [...messages].reverse().find(
      (m: any) => m instanceof AIMessage || m._getType?.() === 'ai'
    );

    const response = lastAiMessage
      ? typeof lastAiMessage.content === 'string'
        ? lastAiMessage.content
        : lastAiMessage.content.map((c: any) => ('text' in c ? c.text : '')).join('')
      : 'I\'m here to help with your career. What would you like to work on?';

    return {
      response,
      respondingAgent: graphResult.currentAgent || 'supervisor',
      userProfile: graphResult.userProfile || this.userProfile,
      turnsUsed: graphResult.turnCount || 0,
    };
  }

  /**
   * Extract text from ContentBlock array.
   */
  private extractTextFromContent(content: ContentBlock[]): string {
    return content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('\n');
  }

  private rebuildHistoryFromMessages(messages: Message[]): void {
    if (this.conversationHistory.length > 0) return; // Already have history

    // Rebuild from stored messages (limit to recent ones)
    const recent = messages.slice(-16);
    this.conversationHistory = recent.map(msg => {
      const text = this.extractTextFromContent(msg.content);
      return msg.role === 'user'
        ? new HumanMessage(text)
        : new AIMessage(text);
    });
  }

  private emitTraceStep(sessionId: string, step: TraceStep): void {
    this.sendToRenderer({
      type: 'trace.step',
      payload: { sessionId, step },
    });
  }

  private emitTraceUpdate(sessionId: string, stepId: string, updates: Partial<TraceStep>): void {
    this.sendToRenderer({
      type: 'trace.update',
      payload: { sessionId, stepId, updates },
    });
  }
}
