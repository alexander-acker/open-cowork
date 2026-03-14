import { BaseMessage } from '@langchain/core/messages';
import { Annotation } from '@langchain/langgraph';

/**
 * Which specialist agent should handle the current request.
 */
export type AgentRole =
  | 'supervisor'
  | 'resume'
  | 'interview'
  | 'job_search'
  | 'career_strategy'
  | 'networking';

/**
 * Shared state that flows through the Navi agent graph.
 * Uses LangGraph's Annotation for proper reducer semantics.
 */
export const NaviState = Annotation.Root({
  /** Conversation messages */
  messages: Annotation<BaseMessage[]>({
    reducer: (existing, newMessages) => [...existing, ...newMessages],
    default: () => [],
  }),
  /** Which agent is currently active */
  currentAgent: Annotation<AgentRole>({
    reducer: (_prev, next) => next,
    default: () => 'supervisor',
  }),
  /** The supervisor's routing decision */
  nextAgent: Annotation<AgentRole | '__end__'>({
    reducer: (_prev, next) => next,
    default: () => 'supervisor',
  }),
  /** User profile context gathered over the conversation */
  userProfile: Annotation<UserProfile>({
    reducer: (_prev, next) => next,
    default: () => ({}),
  }),
  /** Number of agent turns taken (for token budget enforcement) */
  turnCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
});

export type NaviStateType = typeof NaviState.State;

/**
 * User profile built up across conversations for context.
 */
export interface UserProfile {
  name?: string;
  currentRole?: string;
  targetRoles?: string[];
  skills?: string[];
  experience?: string;
  education?: string;
  industry?: string;
  yearsOfExperience?: number;
  resumeText?: string;
  preferences?: Record<string, string>;
}

/**
 * Configuration for the Navi agent system.
 */
export interface NaviConfig {
  /** Anthropic API key */
  apiKey: string;
  /** Model to use (default: claude-sonnet-4-20250514) */
  model?: string;
  /** Max turns before forcing completion (prevents runaway token usage) */
  maxTurns?: number;
  /** Max tokens per individual agent response */
  maxTokensPerResponse?: number;
  /** Base URL for Anthropic API (for custom endpoints) */
  baseUrl?: string;
}

/**
 * Result from a Navi conversation turn.
 */
export interface NaviResult {
  /** The final response text to show the user */
  response: string;
  /** Which agent produced the response */
  respondingAgent: AgentRole;
  /** Updated user profile */
  userProfile: UserProfile;
  /** Total turns used */
  turnsUsed: number;
}
