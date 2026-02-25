import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateToKorean } from './translate';

const originalEnv = {
  NEXT_PRIVATE_OPENAI_API_KEY: process.env.NEXT_PRIVATE_OPENAI_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};

afterEach(() => {
  process.env.NEXT_PRIVATE_OPENAI_API_KEY = originalEnv.NEXT_PRIVATE_OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
  vi.restoreAllMocks();
});

describe('translateToKorean', () => {
  it('uses NEXT_PRIVATE_OPENAI_API_KEY when configured', async () => {
    process.env.NEXT_PRIVATE_OPENAI_API_KEY = 'next-private-key';
    process.env.OPENAI_API_KEY = '';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '[["먹다"]]' } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await translateToKorean([
      { term: '食べる', reading: 'たべる', meanings: ['to eat'] },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer next-private-key',
        }),
      }),
    );
  });

  it('falls back to OPENAI_API_KEY when NEXT_PRIVATE_OPENAI_API_KEY is missing', async () => {
    delete process.env.NEXT_PRIVATE_OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'openai-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '[["먹다"]]' } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await translateToKorean([
      { term: '食べる', reading: 'たべる', meanings: ['to eat'] },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer openai-key',
        }),
      }),
    );
  });
});
