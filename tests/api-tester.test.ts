import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const openaiModelsList = vi.fn();
  const openaiResponsesCreate = vi.fn();
  const openaiChatCompletionsCreate = vi.fn();
  const openaiCtor = vi.fn().mockImplementation(function (this: any) {
    this.models = { list: openaiModelsList };
    this.responses = { create: openaiResponsesCreate };
    this.chat = { completions: { create: openaiChatCompletionsCreate } };
  });

  const anthropicModelsList = vi.fn();
  const anthropicMessagesCreate = vi.fn();
  const anthropicCtor = vi.fn().mockImplementation(function (this: any) {
    this.models = { list: anthropicModelsList };
    this.messages = { create: anthropicMessagesCreate };
  });

  return {
    openaiCtor,
    openaiModelsList,
    openaiResponsesCreate,
    openaiChatCompletionsCreate,
    anthropicCtor,
    anthropicModelsList,
    anthropicMessagesCreate,
  };
});

vi.mock('openai', () => ({
  default: mocks.openaiCtor,
}));

vi.mock('@anthropic-ai/sdk', () => ({
  Anthropic: mocks.anthropicCtor,
}));

vi.mock('../src/main/config/config-store', () => ({
  PROVIDER_PRESETS: {
    openai: { baseUrl: 'https://api.openai.com/v1' },
    openrouter: { baseUrl: 'https://openrouter.ai/api' },
    anthropic: { baseUrl: 'https://api.anthropic.com' },
    custom: { baseUrl: 'https://example.com' },
  },
}));

import { testApiConnection } from '../src/main/config/api-tester';

describe('testApiConnection', () => {
  beforeEach(() => {
    mocks.openaiCtor.mockImplementation(function (this: any) {
      this.models = { list: mocks.openaiModelsList };
      this.responses = { create: mocks.openaiResponsesCreate };
      this.chat = { completions: { create: mocks.openaiChatCompletionsCreate } };
    });
    mocks.anthropicCtor.mockImplementation(function (this: any) {
      this.models = { list: mocks.anthropicModelsList };
      this.messages = { create: mocks.anthropicMessagesCreate };
    });

    mocks.openaiModelsList.mockReset();
    mocks.openaiResponsesCreate.mockReset();
    mocks.openaiChatCompletionsCreate.mockReset();
    mocks.anthropicModelsList.mockReset();
    mocks.anthropicMessagesCreate.mockReset();

    mocks.openaiModelsList.mockResolvedValue({});
    mocks.openaiResponsesCreate.mockResolvedValue({});
    mocks.openaiChatCompletionsCreate.mockResolvedValue({});
    mocks.anthropicModelsList.mockResolvedValue({});
    mocks.anthropicMessagesCreate.mockResolvedValue({});
  });

  // --- Existing tests ---

  it('uses messages.create for custom anthropic-compatible provider', async () => {
    const result = await testApiConnection({
      provider: 'custom',
      customProtocol: 'anthropic',
      apiKey: 'sk-test',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      model: 'glm-4.7',
      useLiveRequest: false,
    });

    expect(result.ok).toBe(true);
    expect(mocks.anthropicCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-test',
        baseURL: 'https://open.bigmodel.cn/api/anthropic',
        timeout: 30000,
      }),
    );
    expect(mocks.anthropicMessagesCreate).toHaveBeenCalledTimes(1);
    expect(mocks.anthropicModelsList).not.toHaveBeenCalled();
  });

  it('keeps models.list check for direct anthropic when not live request', async () => {
    const result = await testApiConnection({
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-5',
      useLiveRequest: false,
    });

    expect(result.ok).toBe(true);
    expect(mocks.anthropicCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-ant-test',
        timeout: 30000,
      }),
    );
    expect(mocks.anthropicModelsList).toHaveBeenCalledTimes(1);
    expect(mocks.anthropicMessagesCreate).not.toHaveBeenCalled();
  });

  it('maps timeout message to network_error', async () => {
    mocks.anthropicMessagesCreate.mockRejectedValueOnce(new Error('Request timed out'));

    const result = await testApiConnection({
      provider: 'custom',
      customProtocol: 'anthropic',
      apiKey: 'sk-test',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      model: 'glm-4.7',
      useLiveRequest: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('network_error');
    expect(result.details).toMatch(/timed out/i);
  });

  // --- OpenAI provider tests ---

  it('uses OpenAI SDK for openai provider', async () => {
    const result = await testApiConnection({
      provider: 'openai',
      apiKey: 'sk-openai-test',
      model: 'gpt-5.2',
      useLiveRequest: false,
    });

    expect(result.ok).toBe(true);
    expect(mocks.openaiCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-openai-test',
        baseURL: 'https://api.openai.com/v1',
        timeout: 30000,
      }),
    );
    expect(mocks.openaiModelsList).toHaveBeenCalledTimes(1);
    expect(mocks.anthropicCtor).not.toHaveBeenCalled();
  });

  it('uses responses.create for openai live request, falls back to chat.completions', async () => {
    mocks.openaiResponsesCreate.mockRejectedValueOnce(new Error('not supported'));

    const result = await testApiConnection({
      provider: 'openai',
      apiKey: 'sk-openai-test',
      model: 'gpt-5.2',
      useLiveRequest: true,
    });

    expect(result.ok).toBe(true);
    expect(mocks.openaiResponsesCreate).toHaveBeenCalledTimes(1);
    expect(mocks.openaiChatCompletionsCreate).toHaveBeenCalledTimes(1);
  });

  it('uses OpenAI SDK for custom provider with openai protocol', async () => {
    const result = await testApiConnection({
      provider: 'custom',
      customProtocol: 'openai',
      apiKey: 'sk-custom-openai',
      baseUrl: 'https://my-proxy.example.com/v1',
      useLiveRequest: false,
    });

    expect(result.ok).toBe(true);
    expect(mocks.openaiCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-custom-openai',
        baseURL: 'https://my-proxy.example.com/v1',
        timeout: 30000,
      }),
    );
    expect(mocks.openaiModelsList).toHaveBeenCalledTimes(1);
  });

  // --- OpenRouter provider tests ---

  it('uses authToken for openrouter provider', async () => {
    const result = await testApiConnection({
      provider: 'openrouter',
      apiKey: 'sk-or-v1-test',
      model: 'anthropic/claude-sonnet-4.5',
      useLiveRequest: false,
    });

    expect(result.ok).toBe(true);
    expect(mocks.anthropicCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        authToken: 'sk-or-v1-test',
        baseURL: 'https://openrouter.ai/api',
        timeout: 30000,
      }),
    );
    // OpenRouter always uses messages.create (not models.list)
    expect(mocks.anthropicMessagesCreate).toHaveBeenCalledTimes(1);
    expect(mocks.anthropicModelsList).not.toHaveBeenCalled();
  });

  // --- Validation tests ---

  it('returns missing_key when apiKey is empty', async () => {
    const result = await testApiConnection({
      provider: 'anthropic',
      apiKey: '',
    });

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('missing_key');
  });

  it('returns missing_key when apiKey is whitespace only', async () => {
    const result = await testApiConnection({
      provider: 'anthropic',
      apiKey: '   ',
    });

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('missing_key');
  });

  it('returns missing_base_url for custom provider without baseUrl', async () => {
    const result = await testApiConnection({
      provider: 'custom',
      customProtocol: 'anthropic',
      apiKey: 'sk-test',
      baseUrl: '',
    });

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('missing_base_url');
  });

  // --- Error mapping tests ---

  it('maps 401 to unauthorized error', async () => {
    const error = new Error('Unauthorized') as any;
    error.status = 401;
    mocks.anthropicModelsList.mockRejectedValueOnce(error);

    const result = await testApiConnection({
      provider: 'anthropic',
      apiKey: 'sk-bad-key',
      useLiveRequest: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('unauthorized');
    expect(result.status).toBe(401);
  });

  it('maps 403 to unauthorized error', async () => {
    const error = new Error('Forbidden') as any;
    error.status = 403;
    mocks.anthropicModelsList.mockRejectedValueOnce(error);

    const result = await testApiConnection({
      provider: 'anthropic',
      apiKey: 'sk-forbidden',
      useLiveRequest: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('unauthorized');
  });

  it('maps 404 to not_found error', async () => {
    const error = new Error('Not Found') as any;
    error.status = 404;
    mocks.openaiModelsList.mockRejectedValueOnce(error);

    const result = await testApiConnection({
      provider: 'openai',
      apiKey: 'sk-test',
      useLiveRequest: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('not_found');
  });

  it('maps 429 to rate_limited error', async () => {
    const error = new Error('Rate limited') as any;
    error.status = 429;
    mocks.anthropicModelsList.mockRejectedValueOnce(error);

    const result = await testApiConnection({
      provider: 'anthropic',
      apiKey: 'sk-test',
      useLiveRequest: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('rate_limited');
  });

  it('maps 500+ to server_error', async () => {
    const error = new Error('Internal Server Error') as any;
    error.status = 502;
    mocks.anthropicModelsList.mockRejectedValueOnce(error);

    const result = await testApiConnection({
      provider: 'anthropic',
      apiKey: 'sk-test',
      useLiveRequest: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('server_error');
  });

  it('maps ECONNREFUSED to network_error', async () => {
    const error = new Error('Connection refused') as any;
    error.code = 'ECONNREFUSED';
    mocks.openaiModelsList.mockRejectedValueOnce(error);

    const result = await testApiConnection({
      provider: 'openai',
      apiKey: 'sk-test',
      useLiveRequest: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('network_error');
  });

  it('maps ENOTFOUND to network_error', async () => {
    const error = new Error('getaddrinfo ENOTFOUND') as any;
    error.code = 'ENOTFOUND';
    mocks.anthropicMessagesCreate.mockRejectedValueOnce(error);

    const result = await testApiConnection({
      provider: 'openrouter',
      apiKey: 'sk-or-test',
      useLiveRequest: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('network_error');
  });

  it('maps unknown errors to unknown type', async () => {
    mocks.anthropicModelsList.mockRejectedValueOnce(new Error('Something unexpected'));

    const result = await testApiConnection({
      provider: 'anthropic',
      apiKey: 'sk-test',
      useLiveRequest: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('unknown');
    expect(result.details).toMatch(/something unexpected/i);
  });

  it('returns latencyMs on success', async () => {
    const result = await testApiConnection({
      provider: 'anthropic',
      apiKey: 'sk-test',
      useLiveRequest: false,
    });

    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeDefined();
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  // --- Anthropic live request test ---

  it('uses messages.create for anthropic with useLiveRequest', async () => {
    const result = await testApiConnection({
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-5',
      useLiveRequest: true,
    });

    expect(result.ok).toBe(true);
    expect(mocks.anthropicMessagesCreate).toHaveBeenCalledTimes(1);
    expect(mocks.anthropicMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-5',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    );
    expect(mocks.anthropicModelsList).not.toHaveBeenCalled();
  });
});
