/**
 * Pinchtab Browser MCP Server
 *
 * Wraps the Pinchtab HTTP API as MCP tools so the Navi agent can control
 * a headless (or headed) Chrome browser using stable accessibility-tree refs.
 *
 * Lifecycle:
 *  1. On init, resolve the pinchtab binary and spawn it on a free port.
 *  2. Wait for /health to respond.
 *  3. Expose browser_* tools via MCP stdio transport.
 *  4. On process exit, kill the pinchtab subprocess.
 */

import { writeMCPLog } from './mcp-logger.js';
writeMCPLog('=== Pinchtab MCP Server Module Loading ===', 'Bootstrap');

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
writeMCPLog('Imported MCP SDK modules', 'Bootstrap');

import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import * as net from 'net';
writeMCPLog('Imported Node.js built-in modules', 'Bootstrap');

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

function getPinchtabBinaryPath(): string {
  // Allow override via environment variable
  if (process.env.PINCHTAB_BINARY_PATH) {
    return process.env.PINCHTAB_BINARY_PATH;
  }

  const platform = process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';

  let binaryName: string;
  if (platform === 'darwin') {
    binaryName = `pinchtab-darwin-${arch}`;
  } else if (platform === 'linux') {
    binaryName = `pinchtab-linux-${arch}`;
  } else if (platform === 'win32') {
    binaryName = `pinchtab-windows-${arch}.exe`;
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  // Scan ~/.pinchtab/bin/ for versioned subdirs containing the binary.
  // This avoids require.resolve which breaks inside esbuild bundles.
  const binRoot = path.join(os.homedir(), '.pinchtab', 'bin');
  try {
    const entries = fs.readdirSync(binRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const candidate = path.join(binRoot, entry.name, binaryName);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  } catch {
    // binRoot doesn't exist yet
  }

  // Fallback unversioned path (~/.pinchtab/bin/<binary>)
  const fallbackPath = path.join(binRoot, binaryName);
  if (fs.existsSync(fallbackPath)) {
    return fallbackPath;
  }

  throw new Error(
    `Pinchtab binary not found. Run "npm rebuild pinchtab" or set PINCHTAB_BINARY_PATH.`
  );
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function httpRequest(
  method: string,
  urlStr: string,
  body?: string,
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: body
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        : {},
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, data: Buffer.concat(chunks).toString() });
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error('Request timeout'));
    });

    if (body) req.write(body);
    req.end();
  });
}

/** Like httpRequest but returns raw Buffer (for binary endpoints like screenshot). */
function httpRequestRaw(
  method: string,
  urlStr: string,
): Promise<{ status: number; buffer: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          buffer: Buffer.concat(chunks),
          contentType: String(res.headers['content-type'] || 'application/octet-stream'),
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error('Request timeout'));
    });

    req.end();
  });
}

// ---------------------------------------------------------------------------
// Pinchtab process management
// ---------------------------------------------------------------------------

let pinchtabProcess: ChildProcess | null = null;
let pinchtabPort: number = 0;
let baseUrl: string = '';

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      const port = addr.port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForHealth(url: string, timeoutMs: number = 20000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await httpRequest('GET', `${url}/health`);
      if (res.status === 200) {
        writeMCPLog(`Pinchtab healthy at ${url}`, 'Lifecycle');
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Pinchtab failed to become healthy within ${timeoutMs}ms`);
}

async function startPinchtab(): Promise<void> {
  const binaryPath = getPinchtabBinaryPath();
  writeMCPLog(`Binary path: ${binaryPath}`, 'Lifecycle');

  pinchtabPort = process.env.PINCHTAB_PORT
    ? parseInt(process.env.PINCHTAB_PORT, 10)
    : await getFreePort();
  baseUrl = `http://127.0.0.1:${pinchtabPort}`;

  const headless = process.env.PINCHTAB_HEADLESS !== 'false';

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    BRIDGE_PORT: String(pinchtabPort),
    BRIDGE_BIND: '127.0.0.1',
    BRIDGE_HEADLESS: String(headless),
    BRIDGE_NO_RESTORE: 'true',
    BRIDGE_ONLY: '1',
  };

  writeMCPLog(`Starting Pinchtab on port ${pinchtabPort} (headless=${headless})`, 'Lifecycle');

  pinchtabProcess = spawn(binaryPath, [], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pinchtabProcess.stdout?.on('data', (d: Buffer) => {
    writeMCPLog(d.toString().trim(), 'Pinchtab stdout');
  });
  pinchtabProcess.stderr?.on('data', (d: Buffer) => {
    writeMCPLog(d.toString().trim(), 'Pinchtab stderr');
  });

  pinchtabProcess.on('exit', (code) => {
    writeMCPLog(`Pinchtab exited with code ${code}`, 'Lifecycle');
    pinchtabProcess = null;
  });

  await waitForHealth(baseUrl);
}

function stopPinchtab(): void {
  if (pinchtabProcess) {
    writeMCPLog('Stopping Pinchtab process', 'Lifecycle');
    pinchtabProcess.kill();
    pinchtabProcess = null;
  }
}

// Cleanup on exit
process.on('exit', stopPinchtab);
process.on('SIGINT', () => { stopPinchtab(); process.exit(0); });
process.on('SIGTERM', () => { stopPinchtab(); process.exit(0); });

// ---------------------------------------------------------------------------
// API helpers (call PinchTab HTTP endpoints)
// ---------------------------------------------------------------------------

async function ptGet(endpoint: string, params?: Record<string, string>): Promise<any> {
  let url = `${baseUrl}${endpoint}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    if (qs) url += `?${qs}`;
  }
  const res = await httpRequest('GET', url);
  if (res.status >= 400) throw new Error(`Pinchtab GET ${endpoint} → ${res.status}: ${res.data}`);
  try {
    return JSON.parse(res.data);
  } catch {
    return res.data;
  }
}

async function ptPost(endpoint: string, body?: Record<string, any>): Promise<any> {
  const url = `${baseUrl}${endpoint}`;
  const res = await httpRequest('POST', url, body ? JSON.stringify(body) : undefined);
  if (res.status >= 400) throw new Error(`Pinchtab POST ${endpoint} → ${res.status}: ${res.data}`);
  try {
    return JSON.parse(res.data);
  } catch {
    return res.data;
  }
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'pinchtab', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// ── ListTools ────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'browser_navigate',
      description:
        'Navigate the browser to a URL. Use blockImages=true for text-heavy pages.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'URL to navigate to' },
          tabId: { type: 'string', description: 'Tab ID (optional, uses active tab)' },
          timeout: { type: 'number', description: 'Navigation timeout in seconds (default 30)' },
          blockImages: { type: 'boolean', description: 'Block image loading (faster for text tasks)' },
          newTab: { type: 'boolean', description: 'Open in a new tab' },
        },
        required: ['url'],
      },
    },
    {
      name: 'browser_snapshot',
      description:
        'Get the accessibility tree of the current page. Returns element refs (e0, e5, e12) used for browser_action. Use filter=interactive for buttons/links only (~75% smaller). Use format=compact for token efficiency.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          tabId: { type: 'string', description: 'Tab ID (optional)' },
          filter: {
            type: 'string',
            enum: ['interactive'],
            description: 'Only return interactive elements (buttons, links, inputs)',
          },
          format: {
            type: 'string',
            enum: ['json', 'text', 'compact', 'yaml'],
            description: 'Output format (default json, compact recommended)',
          },
          selector: { type: 'string', description: 'CSS selector to scope snapshot (e.g. "main")' },
          maxTokens: { type: 'number', description: 'Truncate output to ~N tokens' },
          diff: { type: 'boolean', description: 'Only return changes since last snapshot' },
        },
      },
    },
    {
      name: 'browser_action',
      description:
        'Perform an action on a page element using its ref from browser_snapshot. Supported kinds: click, type, press, hover, scroll, fill, select, focus.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          kind: {
            type: 'string',
            enum: ['click', 'type', 'press', 'hover', 'scroll', 'fill', 'select', 'focus'],
            description: 'Action type',
          },
          ref: { type: 'string', description: 'Element ref from snapshot (e.g. "e5")' },
          text: { type: 'string', description: 'Text to type (for type/fill)' },
          key: { type: 'string', description: 'Key to press (for press, e.g. "Enter", "Tab")' },
          value: { type: 'string', description: 'Value for select' },
          selector: { type: 'string', description: 'CSS selector (alternative to ref, for fill)' },
          scrollY: { type: 'number', description: 'Pixels to scroll vertically (for scroll)' },
          waitNav: { type: 'boolean', description: 'Wait for navigation after action' },
          tabId: { type: 'string', description: 'Tab ID (optional)' },
        },
        required: ['kind'],
      },
    },
    {
      name: 'browser_text',
      description:
        'Extract readable text from the current page. Cheapest option (~800 tokens). Use mode=raw for full innerText.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          tabId: { type: 'string', description: 'Tab ID (optional)' },
          mode: {
            type: 'string',
            enum: ['readability', 'raw'],
            description: 'Extraction mode (default readability)',
          },
        },
      },
    },
    {
      name: 'browser_screenshot',
      description: 'Take a screenshot of the current page. Returns base64-encoded image.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          tabId: { type: 'string', description: 'Tab ID (optional)' },
          quality: { type: 'number', description: 'JPEG quality 1-100 (default 80)' },
        },
      },
    },
    {
      name: 'browser_tabs',
      description: 'List, open, or close browser tabs.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'new', 'close'],
            description: 'Tab action',
          },
          url: { type: 'string', description: 'URL for new tab' },
          tabId: { type: 'string', description: 'Tab ID to close' },
        },
        required: ['action'],
      },
    },
    {
      name: 'browser_evaluate',
      description: 'Execute JavaScript in the browser and return the result.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          expression: { type: 'string', description: 'JavaScript expression to evaluate' },
          tabId: { type: 'string', description: 'Tab ID (optional)' },
        },
        required: ['expression'],
      },
    },
    {
      name: 'browser_pdf',
      description: 'Export the current page as a PDF. Returns base64-encoded data.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          tabId: { type: 'string', description: 'Tab ID (required)' },
          landscape: { type: 'boolean', description: 'Landscape orientation' },
          scale: { type: 'number', description: 'Print scale 0.1-2.0 (default 1.0)' },
        },
        required: ['tabId'],
      },
    },
  ],
}));

// ── CallTool ─────────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  writeMCPLog(`Tool call: ${name} ${JSON.stringify(args)}`, 'Tool');

  try {
    switch (name) {
      // ── Navigate ──────────────────────────────────────────────────────
      case 'browser_navigate': {
        const body: Record<string, any> = { url: args?.url };
        if (args?.tabId) body.tabId = args.tabId;
        if (args?.timeout) body.timeout = args.timeout;
        if (args?.blockImages) body.blockImages = args.blockImages;
        if (args?.newTab) body.newTab = args.newTab;
        const result = await ptPost('/navigate', body);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      // ── Snapshot ──────────────────────────────────────────────────────
      case 'browser_snapshot': {
        const params: Record<string, string> = {};
        if (args?.tabId) params.tabId = String(args.tabId);
        if (args?.filter) params.filter = String(args.filter);
        if (args?.format) params.format = String(args.format);
        if (args?.selector) params.selector = String(args.selector);
        if (args?.maxTokens) params.maxTokens = String(args.maxTokens);
        if (args?.diff) params.diff = 'true';
        const result = await ptGet('/snapshot', params);
        return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
      }

      // ── Action ────────────────────────────────────────────────────────
      case 'browser_action': {
        const body: Record<string, any> = { kind: args?.kind };
        if (args?.ref) body.ref = args.ref;
        if (args?.text) body.text = args.text;
        if (args?.key) body.key = args.key;
        if (args?.value) body.value = args.value;
        if (args?.selector) body.selector = args.selector;
        if (args?.scrollY !== undefined) body.scrollY = args.scrollY;
        if (args?.waitNav) body.waitNav = args.waitNav;
        if (args?.tabId) body.tabId = args.tabId;
        const result = await ptPost('/action', body);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      // ── Text ──────────────────────────────────────────────────────────
      case 'browser_text': {
        const params: Record<string, string> = {};
        if (args?.tabId) params.tabId = String(args.tabId);
        if (args?.mode) params.mode = String(args.mode);
        const result = await ptGet('/text', params);
        return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
      }

      // ── Screenshot ────────────────────────────────────────────────────
      case 'browser_screenshot': {
        const params: Record<string, string> = { raw: 'true' };
        if (args?.tabId) params.tabId = String(args.tabId);
        if (args?.quality) params.quality = String(args.quality);
        let url = `${baseUrl}/screenshot`;
        const qs = new URLSearchParams(params).toString();
        if (qs) url += `?${qs}`;
        const rawRes = await httpRequestRaw('GET', url);
        if (rawRes.status >= 400) {
          throw new Error(`Pinchtab GET /screenshot → ${rawRes.status}: ${rawRes.buffer.toString()}`);
        }
        const b64 = rawRes.buffer.toString('base64');
        const mime = rawRes.contentType.startsWith('image/') ? rawRes.contentType : 'image/jpeg';
        return {
          content: [{ type: 'image', data: b64, mimeType: mime }],
        };
      }

      // ── Tabs ──────────────────────────────────────────────────────────
      case 'browser_tabs': {
        if (args?.action === 'list') {
          const result = await ptGet('/tabs');
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        } else if (args?.action === 'new') {
          const result = await ptPost('/tab', { action: 'new', url: args?.url || 'about:blank' });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        } else if (args?.action === 'close') {
          const result = await ptPost('/tab', { action: 'close', tabId: args?.tabId });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        return { content: [{ type: 'text', text: 'Unknown tab action' }], isError: true };
      }

      // ── Evaluate ──────────────────────────────────────────────────────
      case 'browser_evaluate': {
        const body: Record<string, any> = { expression: args?.expression };
        if (args?.tabId) body.tabId = args.tabId;
        const result = await ptPost('/evaluate', body);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      // ── PDF ───────────────────────────────────────────────────────────
      case 'browser_pdf': {
        if (!args?.tabId) {
          return { content: [{ type: 'text', text: 'Error: tabId is required for browser_pdf' }], isError: true };
        }
        const tabId = String(args.tabId);
        const params: Record<string, string> = {};
        if (args?.landscape) params.landscape = 'true';
        if (args?.scale) params.scale = String(args.scale);
        const result = await ptGet(`/tabs/${tabId}/pdf`, params);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error: any) {
    writeMCPLog(`Tool error: ${error.message}`, 'Error');
    return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
  }
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  writeMCPLog('Starting Pinchtab MCP Server...', 'Initialization');

  // Start the Pinchtab browser server
  await startPinchtab();

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  writeMCPLog('Pinchtab MCP Server running on stdio', 'Initialization');
}

main().catch((error) => {
  writeMCPLog(`Fatal: ${error.message}`, 'Fatal');
  console.error('[Pinchtab MCP] Fatal error:', error);
  stopPinchtab();
  process.exit(1);
});
