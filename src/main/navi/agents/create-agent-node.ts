import { ChatAnthropic } from '@langchain/anthropic';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
// @ts-ignore - moduleResolution mismatch with bundler-style exports
import { ToolNode } from '@langchain/langgraph/prebuilt';
import type { NaviStateType, AgentRole, UserProfile } from '../types';

/**
 * Creates a specialist agent node function for the LangGraph graph.
 *
 * Each agent:
 * - Gets its own focused system prompt (reduces confusion about which tools to use)
 * - Has ONLY its own tools bound (prevents undeterministic tool selection)
 * - Enforces a token budget per response
 * - Extracts user profile updates from the conversation
 */
export function createAgentNode(
  model: ChatAnthropic,
  systemPrompt: string,
  tools: StructuredTool[],
  agentRole: AgentRole
) {
  // Bind ONLY this agent's tools — this is the key to deterministic tool selection
  const boundModel = tools.length > 0 ? model.bindTools(tools) : model;

  return async (state: NaviStateType): Promise<Partial<NaviStateType>> => {
    // Build the message list with the agent's system prompt
    const systemMsg = new SystemMessage(systemPrompt + formatProfileContext(state.userProfile));

    // Trim message history to last 10 messages to control token usage
    const recentMessages = state.messages.slice(-10);

    const response = await boundModel.invoke([systemMsg, ...recentMessages]);

    // Check if the model wants to use tools
    if (response.tool_calls && response.tool_calls.length > 0) {
      // Execute tools via ToolNode
      const toolNode = new ToolNode(tools);
      const toolResults = await toolNode.invoke({
        messages: [response],
      });

      // Get the final response after tool execution
      const finalResponse = await boundModel.invoke([
        systemMsg,
        ...recentMessages,
        response,
        ...toolResults.messages,
      ]);

      return {
        messages: [response, ...toolResults.messages, finalResponse],
        currentAgent: agentRole,
        nextAgent: 'supervisor',
        turnCount: state.turnCount + 1,
        userProfile: extractProfileUpdates(state.userProfile, recentMessages),
      };
    }

    // No tool calls — return the direct response
    return {
      messages: [response],
      currentAgent: agentRole,
      nextAgent: 'supervisor',
      turnCount: state.turnCount + 1,
      userProfile: extractProfileUpdates(state.userProfile, recentMessages),
    };
  };
}

/**
 * Format user profile as context string to include in system prompt.
 */
function formatProfileContext(profile: UserProfile): string {
  const parts: string[] = [];
  if (profile.name) parts.push(`Name: ${profile.name}`);
  if (profile.currentRole) parts.push(`Current role: ${profile.currentRole}`);
  if (profile.targetRoles?.length) parts.push(`Target roles: ${profile.targetRoles.join(', ')}`);
  if (profile.skills?.length) parts.push(`Skills: ${profile.skills.join(', ')}`);
  if (profile.experience) parts.push(`Experience: ${profile.experience}`);
  if (profile.industry) parts.push(`Industry: ${profile.industry}`);
  if (profile.yearsOfExperience) parts.push(`Years of experience: ${profile.yearsOfExperience}`);

  if (parts.length === 0) return '';
  return `\n\nUser Profile:\n${parts.join('\n')}`;
}

/**
 * Extract user profile updates from recent messages.
 * Looks for common career-related information patterns.
 */
function extractProfileUpdates(currentProfile: UserProfile, messages: any[]): UserProfile {
  const profile = { ...currentProfile };

  for (const msg of messages) {
    if (msg instanceof HumanMessage && typeof msg.content === 'string') {
      const text = msg.content;

      // Extract role mentions
      const roleMatch = text.match(/(?:I am|I'm|I work as|my role is|my title is)\s+(?:a\s+)?([^.!?,]+)/i);
      if (roleMatch) profile.currentRole = roleMatch[1].trim();

      // Extract target role
      const targetMatch = text.match(/(?:I want to be|I'm targeting|looking for|interested in becoming)\s+(?:a\s+)?([^.!?,]+)/i);
      if (targetMatch) {
        profile.targetRoles = [targetMatch[1].trim()];
      }

      // Extract years of experience
      const yearsMatch = text.match(/(\d+)\s*(?:\+\s*)?years?\s*(?:of\s+)?experience/i);
      if (yearsMatch) profile.yearsOfExperience = parseInt(yearsMatch[1]);

      // Extract industry
      const industryMatch = text.match(/(?:in the|in|working in)\s+(tech|healthcare|finance|education|marketing|consulting|engineering|retail|manufacturing|government)\s+(?:industry|sector|field)/i);
      if (industryMatch) profile.industry = industryMatch[1];
    }
  }

  return profile;
}
