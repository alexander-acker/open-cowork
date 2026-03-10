/**
 * Navi Web Search Skill
 *
 * Provides web search and content extraction via Tavily,
 * giving Navi the ability to research job markets, companies,
 * salary data, industry trends, and skill requirements.
 */

import { tavily } from '@tavily/core';
import type { AgentCapability, OpenClawSession } from '../../types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  publishedDate?: string;
}

export interface SearchResponse {
  query: string;
  answer?: string;
  results: SearchResult[];
  responseTime?: number;
}

export interface ExtractResponse {
  results: Array<{ url: string; rawContent: string }>;
  failedResults: Array<{ url: string; error: string }>;
}

export type SearchTopic = 'general' | 'news' | 'finance';
export type SearchDepth = 'basic' | 'advanced';
export type TimeRange = 'day' | 'week' | 'month' | 'year';

export interface SearchOptions {
  searchDepth?: SearchDepth;
  topic?: SearchTopic;
  maxResults?: number;
  includeAnswer?: boolean;
  includeDomains?: string[];
  excludeDomains?: string[];
  timeRange?: TimeRange;
}

// ─── Tavily Client Wrapper ───────────────────────────────────────────────────

export class TavilySearch {
  private client: ReturnType<typeof tavily>;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.TAVILY_API_KEY;
    if (!key) {
      throw new Error(
        'Tavily API key required. Set TAVILY_API_KEY env var or pass apiKey.',
      );
    }
    this.client = tavily({ apiKey: key });
  }

  /**
   * Perform a web search optimized for LLM consumption.
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const response = await this.client.search(query, {
      searchDepth: options.searchDepth ?? 'advanced',
      topic: options.topic ?? 'general',
      maxResults: options.maxResults ?? 5,
      includeAnswer: options.includeAnswer ?? true,
      includeDomains: options.includeDomains,
      excludeDomains: options.excludeDomains,
      timeRange: options.timeRange,
    });

    return {
      query: response.query,
      answer: response.answer,
      results: (response.results || []).map((r: Record<string, unknown>) => ({
        title: String(r.title ?? ''),
        url: String(r.url ?? ''),
        content: String(r.content ?? ''),
        score: Number(r.score ?? 0),
        publishedDate: r.publishedDate ? String(r.publishedDate) : undefined,
      })),
      responseTime: response.responseTime,
    };
  }

  /**
   * Extract raw content from URLs for deeper analysis.
   */
  async extract(urls: string[]): Promise<ExtractResponse> {
    const response = await this.client.extract(urls);
    return {
      results: (response.results || []).map((r: Record<string, unknown>) => ({
        url: String(r.url ?? ''),
        rawContent: String(r.rawContent ?? ''),
      })),
      failedResults: (response.failedResults || []).map((r: Record<string, unknown>) => ({
        url: String(r.url ?? ''),
        error: String(r.error ?? 'Unknown error'),
      })),
    };
  }

  // ─── Career-Oriented Convenience Methods ─────────────────────────────────

  /**
   * Research a company for interview prep or job evaluation.
   */
  async researchCompany(company: string): Promise<SearchResponse> {
    return this.search(`${company} company culture values engineering team reviews`, {
      searchDepth: 'advanced',
      maxResults: 8,
      includeAnswer: true,
    });
  }

  /**
   * Get current salary data for a role.
   */
  async researchSalary(role: string, location?: string): Promise<SearchResponse> {
    const locationStr = location ? ` in ${location}` : '';
    return this.search(`${role} salary compensation range${locationStr} 2025 2026`, {
      searchDepth: 'advanced',
      maxResults: 8,
      includeAnswer: true,
    });
  }

  /**
   * Research job market trends for a role or industry.
   */
  async researchMarket(query: string): Promise<SearchResponse> {
    return this.search(`${query} job market trends hiring demand`, {
      searchDepth: 'advanced',
      topic: 'news',
      maxResults: 8,
      includeAnswer: true,
      timeRange: 'month',
    });
  }

  /**
   * Find learning resources for a skill.
   */
  async findLearningResources(skill: string): Promise<SearchResponse> {
    return this.search(`best resources to learn ${skill} course tutorial guide`, {
      searchDepth: 'advanced',
      maxResults: 8,
      includeAnswer: true,
      excludeDomains: ['pinterest.com', 'quora.com'],
    });
  }

  /**
   * Research interview questions and preparation material.
   */
  async researchInterview(role: string, company?: string): Promise<SearchResponse> {
    const companyStr = company ? ` at ${company}` : '';
    return this.search(`${role}${companyStr} interview questions preparation tips`, {
      searchDepth: 'advanced',
      maxResults: 8,
      includeAnswer: true,
    });
  }
}

// ─── Skill Implementation ────────────────────────────────────────────────────

const WEB_SEARCH_INTENTS = [
  'web-search',
  'market-research',
  'company-research',
  'salary-research',
  'skill-resources',
  'interview-research',
];

export class WebSearchSkill implements AgentCapability {
  skillId = 'navi-web-search';
  name = 'Web Search (Tavily)';
  intents = WEB_SEARCH_INTENTS;

  private tavily: TavilySearch | null = null;

  handles(intent: string): boolean {
    return this.intents.includes(intent);
  }

  async execute(message: string, _session: OpenClawSession): Promise<string> {
    const client = this.getClient();
    if (!client) {
      return 'Web search is unavailable — TAVILY_API_KEY is not configured.';
    }

    const response = await client.search(message, {
      searchDepth: 'advanced',
      includeAnswer: true,
      maxResults: 5,
    });

    if (response.answer) {
      return response.answer;
    }

    return response.results
      .map(r => `**${r.title}**\n${r.content}\n${r.url}`)
      .join('\n\n');
  }

  /**
   * Get the underlying TavilySearch client for direct use by other skills.
   */
  getClient(): TavilySearch | null {
    if (!this.tavily) {
      try {
        this.tavily = new TavilySearch();
      } catch {
        return null;
      }
    }
    return this.tavily;
  }

  /**
   * Check if web search is available (API key configured).
   */
  isAvailable(): boolean {
    return this.getClient() !== null;
  }
}

export default WebSearchSkill;
