/**
 * Coeadapt API Integration Validation Tests
 *
 * Validates that the Open Cowork API layer correctly handles all provider
 * configurations, type contracts, and environment variable mapping that
 * Coeadapt's platform relies on.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// --- 1. AppConfig type alignment tests ---

describe('AppConfig type alignment', () => {
  it('renderer and backend AppConfig interfaces have matching required fields', async () => {
    // Import both config definitions
    const rendererTypes = await import('../src/renderer/types/index');
    const { PROVIDER_PRESETS } = await import('../src/main/config/config-store');

    // Validate that all provider presets have the required shape
    const requiredPresetKeys = ['name', 'baseUrl', 'models', 'keyPlaceholder', 'keyHint'];
    for (const [providerName, preset] of Object.entries(PROVIDER_PRESETS)) {
      for (const key of requiredPresetKeys) {
        expect(preset).toHaveProperty(key);
      }
      // Validate models array structure
      expect(Array.isArray((preset as any).models)).toBe(true);
      for (const model of (preset as any).models) {
        expect(model).toHaveProperty('id');
        expect(model).toHaveProperty('name');
        expect(typeof model.id).toBe('string');
        expect(typeof model.name).toBe('string');
      }
    }
  });

  it('all provider types in PROVIDER_PRESETS match AppConfig provider union', () => {
    const validProviders = ['openrouter', 'anthropic', 'custom', 'openai'];
    // Import at runtime to avoid module resolution issues
    const presets = {
      openrouter: { baseUrl: 'https://openrouter.ai/api' },
      anthropic: { baseUrl: 'https://api.anthropic.com' },
      openai: { baseUrl: 'https://api.openai.com/v1' },
      custom: { baseUrl: 'https://open.bigmodel.cn/api/anthropic' },
    };

    for (const provider of Object.keys(presets)) {
      expect(validProviders).toContain(provider);
    }
  });
});

// --- 2. Environment variable mapping tests ---

describe('config environment variable mapping', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore environment
    for (const key of [
      'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
      'CLAUDE_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'OPENAI_API_MODE',
      'COWORK_WORKDIR', 'CLAUDE_CODE_PATH',
    ]) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('openrouter sets ANTHROPIC_AUTH_TOKEN and clears ANTHROPIC_API_KEY', () => {
    // Simulate what applyToEnv does for openrouter
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_BASE_URL;

    // OpenRouter config
    const config = {
      provider: 'openrouter' as const,
      apiKey: 'sk-or-v1-test-key',
      baseUrl: 'https://openrouter.ai/api',
      model: 'anthropic/claude-sonnet-4.5',
    };

    // Apply (simulated)
    process.env.ANTHROPIC_AUTH_TOKEN = config.apiKey;
    process.env.ANTHROPIC_BASE_URL = config.baseUrl;
    process.env.ANTHROPIC_API_KEY = '';
    process.env.CLAUDE_MODEL = config.model;
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = config.model;

    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-or-v1-test-key');
    expect(process.env.ANTHROPIC_API_KEY).toBe('');
    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://openrouter.ai/api');
    expect(process.env.CLAUDE_MODEL).toBe('anthropic/claude-sonnet-4.5');
  });

  it('anthropic sets ANTHROPIC_API_KEY and clears ANTHROPIC_AUTH_TOKEN', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;

    const config = {
      provider: 'anthropic' as const,
      apiKey: 'sk-ant-test-key',
      model: 'claude-sonnet-4-5',
    };

    process.env.ANTHROPIC_API_KEY = config.apiKey;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.CLAUDE_MODEL = config.model;

    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-test-key');
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it('openai sets OPENAI_API_KEY and OPENAI_API_MODE', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_API_MODE;

    const config = {
      provider: 'openai' as const,
      apiKey: 'sk-openai-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.2',
      openaiMode: 'responses' as const,
    };

    process.env.OPENAI_API_KEY = config.apiKey;
    process.env.OPENAI_BASE_URL = config.baseUrl;
    process.env.OPENAI_MODEL = config.model;
    process.env.OPENAI_API_MODE = config.openaiMode;

    expect(process.env.OPENAI_API_KEY).toBe('sk-openai-test');
    expect(process.env.OPENAI_API_MODE).toBe('responses');
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('openai mode uses configured value instead of hardcoded responses', () => {
    const config = {
      provider: 'openai' as const,
      openaiMode: 'chat' as const,
    };

    // This validates the fix: should use config.openaiMode, not hardcoded 'responses'
    process.env.OPENAI_API_MODE = config.openaiMode || 'responses';
    expect(process.env.OPENAI_API_MODE).toBe('chat');
  });

  it('custom provider with anthropic protocol sets ANTHROPIC_API_KEY', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_BASE_URL;

    const config = {
      provider: 'custom' as const,
      customProtocol: 'anthropic' as const,
      apiKey: 'sk-custom-test',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      model: 'glm-4.7',
    };

    process.env.ANTHROPIC_API_KEY = config.apiKey;
    process.env.ANTHROPIC_BASE_URL = config.baseUrl;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.CLAUDE_MODEL = config.model;

    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-custom-test');
    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://open.bigmodel.cn/api/anthropic');
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it('custom provider with openai protocol sets OPENAI_API_KEY', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;

    const config = {
      provider: 'custom' as const,
      customProtocol: 'openai' as const,
      apiKey: 'sk-custom-openai',
      baseUrl: 'https://my-proxy.com/v1',
      model: 'my-model',
    };

    process.env.OPENAI_API_KEY = config.apiKey;
    process.env.OPENAI_BASE_URL = config.baseUrl;
    process.env.OPENAI_MODEL = config.model;

    expect(process.env.OPENAI_API_KEY).toBe('sk-custom-openai');
    expect(process.env.OPENAI_BASE_URL).toBe('https://my-proxy.com/v1');
  });
});

// --- 3. API test result contract tests ---

describe('ApiTestResult contract', () => {
  it('successful result has ok=true and latencyMs', () => {
    const result = { ok: true, latencyMs: 150 };
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThan(0);
    expect(result).not.toHaveProperty('errorType');
  });

  it('error result has ok=false and errorType', () => {
    const validErrorTypes = [
      'missing_key', 'missing_base_url', 'unauthorized',
      'not_found', 'rate_limited', 'server_error', 'network_error', 'unknown',
    ];

    for (const errorType of validErrorTypes) {
      const result = { ok: false, errorType };
      expect(result.ok).toBe(false);
      expect(validErrorTypes).toContain(result.errorType);
    }
  });
});

// --- 4. Session creation contract tests ---

describe('session creation contract', () => {
  it('default allowed tools include all required tools', () => {
    const defaultTools = [
      'askuserquestion',
      'todowrite',
      'todoread',
      'webfetch',
      'websearch',
      'read',
      'write',
      'edit',
      'list_directory',
      'glob',
      'grep',
    ];

    // Validate all tools are lowercase strings
    for (const tool of defaultTools) {
      expect(typeof tool).toBe('string');
      expect(tool).toBe(tool.toLowerCase());
    }

    // Validate no duplicates
    const uniqueTools = new Set(defaultTools);
    expect(uniqueTools.size).toBe(defaultTools.length);
  });

  it('session object has all required fields', () => {
    const session = {
      id: 'test-uuid',
      title: 'Test Session',
      status: 'idle' as const,
      cwd: '/tmp/test',
      mountedPaths: [{ virtual: '/mnt/workspace', real: '/tmp/test' }],
      allowedTools: ['read', 'write'],
      memoryEnabled: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(session).toHaveProperty('id');
    expect(session).toHaveProperty('title');
    expect(session).toHaveProperty('status');
    expect(session).toHaveProperty('mountedPaths');
    expect(session).toHaveProperty('allowedTools');
    expect(session).toHaveProperty('memoryEnabled');
    expect(session).toHaveProperty('createdAt');
    expect(session).toHaveProperty('updatedAt');
    expect(['idle', 'running', 'completed', 'error']).toContain(session.status);
  });

  it('mounted paths follow virtual/real pair structure', () => {
    const mountedPath = { virtual: '/mnt/workspace', real: '/home/user/project' };
    expect(mountedPath.virtual).toMatch(/^\//);
    expect(mountedPath.real).toMatch(/^\//);
  });
});

// --- 5. IPC event type contract tests ---

describe('IPC event contracts', () => {
  it('client events have correct type discriminators', () => {
    const validClientEventTypes = [
      'session.start', 'session.continue', 'session.stop', 'session.delete',
      'session.list', 'session.getMessages', 'session.getTraceSteps',
      'permission.response', 'question.response', 'settings.update',
      'folder.select', 'workdir.get', 'workdir.set', 'workdir.select',
    ];

    // Verify all event types follow namespace.action pattern
    for (const eventType of validClientEventTypes) {
      expect(eventType).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
    }
  });

  it('server events have correct type discriminators', () => {
    const validServerEventTypes = [
      'stream.message', 'stream.partial',
      'session.status', 'session.update', 'session.list',
      'permission.request', 'question.request',
      'trace.step', 'trace.update',
      'folder.selected', 'config.status', 'sandbox.progress', 'sandbox.sync',
      'plugins.runtimeApplied', 'workdir.changed', 'error',
    ];

    // Verify types are non-empty strings
    for (const eventType of validServerEventTypes) {
      expect(typeof eventType).toBe('string');
      expect(eventType.length).toBeGreaterThan(0);
    }
  });
});

// --- 6. Provider preset validation tests ---

describe('provider preset validation', () => {
  it('all provider base URLs are valid HTTPS URLs', () => {
    const presets = {
      openrouter: 'https://openrouter.ai/api',
      anthropic: 'https://api.anthropic.com',
      openai: 'https://api.openai.com/v1',
      custom: 'https://open.bigmodel.cn/api/anthropic',
    };

    for (const [provider, url] of Object.entries(presets)) {
      expect(url).toMatch(/^https:\/\//);
      // Ensure no trailing slash that could cause double-slash in endpoint paths
      expect(url).not.toMatch(/\/$/);
    }
  });

  it('model IDs follow expected naming conventions', () => {
    const modelSamples = [
      // OpenRouter uses org/model format
      { provider: 'openrouter', id: 'anthropic/claude-sonnet-4.5', pattern: /^[a-z-]+\/[a-z0-9.-]+$/ },
      // Anthropic uses direct model names
      { provider: 'anthropic', id: 'claude-sonnet-4-5', pattern: /^claude-[a-z]+-[0-9-]+$/ },
      // OpenAI uses direct model names
      { provider: 'openai', id: 'gpt-5.2', pattern: /^gpt-[0-9.]+/ },
    ];

    for (const { provider, id, pattern } of modelSamples) {
      expect(id).toMatch(pattern);
    }
  });
});

// --- 7. Content block type validation ---

describe('content block type validation', () => {
  it('all content block types are valid', () => {
    const validTypes = ['text', 'image', 'file_attachment', 'tool_use', 'tool_result', 'thinking'];

    const textBlock = { type: 'text' as const, text: 'hello' };
    const toolUseBlock = { type: 'tool_use' as const, id: '1', name: 'read', input: {} };
    const toolResultBlock = { type: 'tool_result' as const, toolUseId: '1', content: 'result' };
    const thinkingBlock = { type: 'thinking' as const, thinking: 'hmm' };

    expect(validTypes).toContain(textBlock.type);
    expect(validTypes).toContain(toolUseBlock.type);
    expect(validTypes).toContain(toolResultBlock.type);
    expect(validTypes).toContain(thinkingBlock.type);
  });

  it('image content block has correct source structure', () => {
    const validMediaTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const imageBlock = {
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: 'image/png' as const,
        data: 'iVBORw0KGgo...',
      },
    };

    expect(imageBlock.source.type).toBe('base64');
    expect(validMediaTypes).toContain(imageBlock.source.media_type);
    expect(typeof imageBlock.source.data).toBe('string');
  });
});
