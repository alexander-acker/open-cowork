import * as http from 'node:http';
import {
  CopilotRuntime,
  AnthropicAdapter,
  OpenAIAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from '@copilotkit/runtime';
import { configStore } from '../config/config-store';
import { log, logWarn, logError } from '../utils/logger';

let server: http.Server | null = null;
let serverPort: number | null = null;

/**
 * Start the CopilotKit runtime HTTP server on a random available port.
 * Uses the user's configured API provider and key.
 */
export async function startCopilotKitServer(): Promise<number> {
  if (server) {
    log('[CopilotKit] Server already running on port', serverPort);
    return serverPort!;
  }

  const config = configStore.getAll();
  const serviceAdapter = createServiceAdapter(config);

  const runtime = new CopilotRuntime({
    actions: [
      {
        name: 'getAppState',
        description:
          'Get the current state of the Open Cowork application including active sessions and configuration.',
        parameters: [],
        handler: async () => {
          return JSON.stringify({
            isConfigured: config.isConfigured,
            provider: config.provider,
            model: config.model,
            sandboxEnabled: config.sandboxEnabled,
          });
        },
      },
    ],
  });

  const handler = copilotRuntimeNodeHttpEndpoint({
    runtime,
    serviceAdapter,
    endpoint: '/copilotkit',
  });

  server = http.createServer(async (req, res) => {
    // CORS headers for renderer process
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.url?.startsWith('/copilotkit')) {
      try {
        await handler(req, res);
      } catch (err) {
        logError('[CopilotKit] Handler error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  return new Promise<number>((resolve, reject) => {
    server!.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      if (typeof addr === 'object' && addr) {
        serverPort = addr.port;
        log('[CopilotKit] Runtime server started on port', serverPort);
        resolve(serverPort);
      } else {
        reject(new Error('Failed to get server address'));
      }
    });

    server!.on('error', (err) => {
      logError('[CopilotKit] Server error:', err);
      reject(err);
    });
  });
}

/**
 * Stop the CopilotKit runtime server.
 */
export async function stopCopilotKitServer(): Promise<void> {
  if (server) {
    return new Promise((resolve) => {
      server!.close(() => {
        log('[CopilotKit] Server stopped');
        server = null;
        serverPort = null;
        resolve();
      });
    });
  }
}

/**
 * Restart the CopilotKit server (e.g. after config change).
 */
export async function restartCopilotKitServer(): Promise<number> {
  await stopCopilotKitServer();
  return startCopilotKitServer();
}

/**
 * Get the current CopilotKit runtime URL.
 */
export function getCopilotKitUrl(): string | null {
  if (!serverPort) return null;
  return `http://127.0.0.1:${serverPort}/copilotkit`;
}

/**
 * Create the appropriate service adapter based on user config.
 */
function createServiceAdapter(config: ReturnType<typeof configStore.getAll>) {
  const provider = config.provider;
  const apiKey = config.apiKey;

  if (!apiKey) {
    logWarn('[CopilotKit] No API key configured, using empty adapter');
    return new OpenAIAdapter({ model: 'gpt-4o' });
  }

  switch (provider) {
    case 'anthropic':
      return new AnthropicAdapter({
        model: config.model || 'claude-sonnet-4-5-20250514',
      });

    case 'openai':
      return new OpenAIAdapter({
        model: config.model || 'gpt-4o',
      });

    case 'openrouter':
      // OpenRouter uses OpenAI-compatible API
      return new OpenAIAdapter({
        model: config.model || 'anthropic/claude-sonnet-4.5',
      });

    case 'custom':
      if (config.customProtocol === 'anthropic') {
        return new AnthropicAdapter({
          model: config.model || 'claude-sonnet-4-5-20250514',
        });
      }
      return new OpenAIAdapter({
        model: config.model || 'gpt-4o',
      });

    default:
      return new OpenAIAdapter({
        model: config.model || 'gpt-4o',
      });
  }
}
