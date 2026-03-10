/**
 * ComputerUseSession — Anthropic Computer Use API tool loop.
 * Sends screenshots + actions to Claude via the Anthropic SDK,
 * processes tool_use responses, and executes them via the adapter.
 */

import Anthropic from '@anthropic-ai/sdk';
import { log, logError } from '../utils/logger';
import type { ComputerUseProvider, ComputerUseAction } from './computer-use-provider';
import type { ServerEvent } from '../../renderer/types';

const MAX_TOOL_LOOPS_DEFAULT = 25;

export interface ComputerUseSessionOptions {
  adapter: ComputerUseProvider;
  apiKey: string;
  model?: string;
  maxLoops?: number;
  sendToRenderer: (event: ServerEvent) => void;
  saveMessage: (sessionId: string, role: 'user' | 'assistant' | 'system', content: any[]) => void;
  sessionId: string;
}

export class ComputerUseSession {
  private adapter: ComputerUseProvider;
  private client: Anthropic;
  private model: string;
  private maxLoops: number;
  private sendToRenderer: (event: ServerEvent) => void;
  private saveMessage: (sessionId: string, role: 'user' | 'assistant' | 'system', content: any[]) => void;
  private sessionId: string;
  private aborted = false;

  constructor(options: ComputerUseSessionOptions) {
    this.adapter = options.adapter;
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model || 'claude-sonnet-4-5-20250929';
    this.maxLoops = options.maxLoops ?? MAX_TOOL_LOOPS_DEFAULT;
    this.sendToRenderer = options.sendToRenderer;
    this.saveMessage = options.saveMessage;
    this.sessionId = options.sessionId;
  }

  abort(): void {
    this.aborted = true;
    log('[ComputerUseSession] Aborted');
  }

  async run(userPrompt: string, systemPrompt: string): Promise<void> {
    const displaySize = this.adapter.getDisplaySize();
    log('[ComputerUseSession] Starting. Display:', displaySize.width, 'x', displaySize.height);

    // Take initial screenshot
    const initialScreenshot = await this.adapter.execute({ action: 'screenshot' });

    const tools: Anthropic.Tool[] = [
      {
        type: 'computer_20250124',
        name: 'computer',
        display_width_px: displaySize.width,
        display_height_px: displaySize.height,
        display_number: 1,
      } as any,
    ];

    // Build initial messages with screenshot
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          ...(initialScreenshot.base64Image
            ? [
                {
                  type: 'image' as const,
                  source: {
                    type: 'base64' as const,
                    media_type: 'image/png' as const,
                    data: initialScreenshot.base64Image,
                  },
                },
              ]
            : []),
        ],
      },
    ];

    let loopCount = 0;

    while (loopCount < this.maxLoops && !this.aborted) {
      loopCount++;
      log(`[ComputerUseSession] Loop ${loopCount}/${this.maxLoops}`);

      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 4096,
          system: systemPrompt,
          tools,
          messages,
        });

        log('[ComputerUseSession] Response stop_reason:', response.stop_reason);

        // Extract text and tool_use blocks
        const textBlocks: string[] = [];
        const toolUseBlocks: Array<{ id: string; name: string; input: any }> = [];

        for (const block of response.content) {
          if (block.type === 'text') {
            textBlocks.push(block.text);
          } else if (block.type === 'tool_use') {
            toolUseBlocks.push({
              id: block.id,
              name: block.name,
              input: block.input as any,
            });
          }
        }

        // Send text to renderer
        if (textBlocks.length > 0) {
          const text = textBlocks.join('\n');
          this.sendToRenderer({
            type: 'stream.message',
            payload: {
              sessionId: this.sessionId,
              message: {
                id: `cu-${Date.now()}`,
                sessionId: this.sessionId,
                role: 'assistant',
                content: [{ type: 'text', text }],
                timestamp: Date.now(),
              },
            },
          });
          this.saveMessage(this.sessionId, 'assistant', [{ type: 'text', text }]);
        }

        // Add assistant response to messages
        messages.push({ role: 'assistant', content: response.content });

        // If no tool use, we're done
        if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
          log('[ComputerUseSession] Completed (end_turn or no tools)');
          break;
        }

        // Execute each tool use and collect results
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          if (this.aborted) break;

          const action = toolUse.input as ComputerUseAction;
          log('[ComputerUseSession] Executing action:', action.action);

          const result = await this.adapter.execute(action);

          if (result.type === 'error') {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [{ type: 'text', text: `Error: ${result.error}` }],
              is_error: true,
            });
          } else if (result.type === 'coordinate') {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [
                {
                  type: 'text',
                  text: `Cursor position: x=${result.coordinate![0]}, y=${result.coordinate![1]}`,
                },
              ],
            });
          } else if (result.base64Image) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: result.base64Image,
                  },
                },
              ],
            });
          }
        }

        // Add tool results to messages
        messages.push({ role: 'user', content: toolResults });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logError('[ComputerUseSession] API error:', msg);
        this.sendToRenderer({
          type: 'stream.message',
          payload: {
            sessionId: this.sessionId,
            message: {
              id: `cu-err-${Date.now()}`,
              sessionId: this.sessionId,
              role: 'assistant',
              content: [{ type: 'text', text: `Computer use error: ${msg}` }],
              timestamp: Date.now(),
            },
          },
        });
        break;
      }
    }

    if (loopCount >= this.maxLoops) {
      log('[ComputerUseSession] Reached max loops limit');
    }
  }
}
