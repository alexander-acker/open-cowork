import { ChatAnthropic } from '@langchain/anthropic';
import { StateGraph, END } from '@langchain/langgraph';
import { SystemMessage } from '@langchain/core/messages';
import { NaviState, type NaviConfig, type AgentRole } from '../types';
import { createAgentNode } from '../agents/create-agent-node';
import {
  SUPERVISOR_PROMPT,
  RESUME_AGENT_PROMPT,
  INTERVIEW_AGENT_PROMPT,
  JOB_SEARCH_AGENT_PROMPT,
  CAREER_STRATEGY_AGENT_PROMPT,
  NETWORKING_AGENT_PROMPT,
} from '../agents/agent-prompts';
import { resumeTools } from '../tools/resume-tools';
import { interviewTools } from '../tools/interview-tools';
import { jobSearchTools } from '../tools/job-search-tools';
import { careerStrategyTools } from '../tools/career-strategy-tools';
import { networkingTools } from '../tools/networking-tools';

const VALID_AGENTS: AgentRole[] = ['resume', 'interview', 'job_search', 'career_strategy', 'networking'];

/**
 * Build the Navi career agent graph using LangGraph.
 *
 * Architecture:
 *   User → Supervisor → [Specialist Agent] → Response
 *
 * The supervisor classifies intent and routes to the right specialist.
 * Each specialist has ONLY its own tools bound, ensuring deterministic tool use.
 * Token usage is controlled by:
 *   - Message trimming (last 10 messages per agent call)
 *   - Max turns limit (prevents runaway loops)
 *   - Max tokens per response on the model
 *   - Single-pass specialist responses (no agent-to-agent chatter)
 */
export function buildNaviGraph(config: NaviConfig) {
  const modelConfig = {
    model: config.model || 'claude-sonnet-4-20250514',
    anthropicApiKey: config.apiKey,
    maxTokens: config.maxTokensPerResponse || 1024,
    temperature: 0, // Deterministic routing and responses
    ...(config.baseUrl ? { anthropicApiUrl: config.baseUrl } : {}),
  };

  // Supervisor uses a smaller/faster model for routing (saves tokens)
  const supervisorModel = new ChatAnthropic({
    ...modelConfig,
    maxTokens: 150, // Routing decisions are very short
  });

  // Specialist agents use the full model
  const agentModel = new ChatAnthropic(modelConfig);

  const maxTurns = config.maxTurns || 6;

  // -- Supervisor Node --
  const supervisorNode = async (state: typeof NaviState.State) => {
    // Enforce turn limit
    if (state.turnCount >= maxTurns) {
      return {
        nextAgent: '__end__' as const,
        turnCount: state.turnCount,
      };
    }

    const systemMsg = new SystemMessage(SUPERVISOR_PROMPT);
    const recentMessages = state.messages.slice(-5); // Supervisor only needs recent context

    const response = await supervisorModel.invoke([systemMsg, ...recentMessages]);
    const content = typeof response.content === 'string'
      ? response.content
      : response.content.map((c: any) => ('text' in c ? c.text : '')).join('');

    // Parse the supervisor's routing decision
    let nextAgent: AgentRole | '__end__' = 'career_strategy'; // Safe default
    try {
      // Extract JSON from response (handle potential markdown wrapping)
      const jsonMatch = content.match(/\{[^}]+\}/);
      if (jsonMatch) {
        const decision = JSON.parse(jsonMatch[0]);
        if (decision.next === '__end__' || VALID_AGENTS.includes(decision.next)) {
          nextAgent = decision.next;
        }
      }
    } catch {
      // If parsing fails, default to career_strategy (safest general agent)
      nextAgent = 'career_strategy';
    }

    return {
      nextAgent,
      turnCount: state.turnCount,
    };
  };

  // -- Specialist Agent Nodes --
  const resumeNode = createAgentNode(agentModel, RESUME_AGENT_PROMPT, resumeTools, 'resume');
  const interviewNode = createAgentNode(agentModel, INTERVIEW_AGENT_PROMPT, interviewTools, 'interview');
  const jobSearchNode = createAgentNode(agentModel, JOB_SEARCH_AGENT_PROMPT, jobSearchTools, 'job_search');
  const careerStrategyNode = createAgentNode(agentModel, CAREER_STRATEGY_AGENT_PROMPT, careerStrategyTools, 'career_strategy');
  const networkingNode = createAgentNode(agentModel, NETWORKING_AGENT_PROMPT, networkingTools, 'networking');

  // -- Build the Graph --
  const graph = new StateGraph(NaviState)
    .addNode('supervisor', supervisorNode)
    .addNode('resume', resumeNode)
    .addNode('interview', interviewNode)
    .addNode('job_search', jobSearchNode)
    .addNode('career_strategy', careerStrategyNode)
    .addNode('networking', networkingNode)
    // Entry point: always start with supervisor
    .addEdge('__start__', 'supervisor')
    // Supervisor routes to the appropriate agent (or ends)
    .addConditionalEdges('supervisor', (state) => {
      return state.nextAgent === '__end__' ? END : state.nextAgent;
    })
    // All specialist agents return to end (single-pass, no looping back to supervisor)
    // This prevents runaway agent-to-agent conversations and saves tokens
    .addEdge('resume', '__end__')
    .addEdge('interview', '__end__')
    .addEdge('job_search', '__end__')
    .addEdge('career_strategy', '__end__')
    .addEdge('networking', '__end__');

  return graph.compile();
}
