import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PendingToolBatch } from '@/types/chat';

// Mock heavy / side-effecting deps so the store loads cleanly in node.
vi.mock('./inference', () => ({
  streamInfer: vi.fn(),
  cancelInfer: vi.fn(),
}));
vi.mock('./attachments', () => ({
  storeAttachment: vi.fn(),
  getAttachmentPreviewUrl: vi.fn(),
}));
vi.mock('./metrics', () => ({
  recordMetric: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { useChatStore } from './store';

function makeBatch(overrides: Partial<PendingToolBatch> = {}): PendingToolBatch {
  return {
    id: 'batch-1',
    messageId: 'msg-1',
    toolName: 'add_word',
    status: 'awaiting_confirm',
    items: [
      {
        callId: 'c1',
        args: { term: '猫' },
        status: 'pending',
        selected: true,
      },
      {
        callId: 'c2',
        args: { term: '犬' },
        status: 'pending',
        selected: true,
      },
      {
        callId: 'c3',
        args: { term: '鳥' },
        status: 'pending',
        selected: true,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  // Reset store state between tests (zustand `setState` performs a partial
  // shallow merge — we explicitly reset the slices we touch).
  useChatStore.setState({
    pendingConfirms: [],
    generalSession: null,
    contextSessions: {},
    activeInference: null,
    unreadCount: 0,
    lastViewedAt: {},
  });
});

describe('useChatStore — batch state ops', () => {
  describe('toggleBatchItem', () => {
    it('flips a single item from selected → deselected', () => {
      useChatStore.setState({ pendingConfirms: [makeBatch()] });
      useChatStore.getState().toggleBatchItem('batch-1', 'c2');
      const items = useChatStore.getState().pendingConfirms[0].items;
      expect(items.find((i) => i.callId === 'c2')?.selected).toBe(false);
      expect(items.find((i) => i.callId === 'c1')?.selected).toBe(true);
      expect(items.find((i) => i.callId === 'c3')?.selected).toBe(true);
    });

    it('is a no-op for an unknown batch id', () => {
      useChatStore.setState({ pendingConfirms: [makeBatch()] });
      useChatStore.getState().toggleBatchItem('nope', 'c1');
      expect(useChatStore.getState().pendingConfirms[0].items[0].selected).toBe(true);
    });
  });

  describe('setBatchItemsSelected', () => {
    it('selects all items', () => {
      useChatStore.setState({
        pendingConfirms: [
          {
            ...makeBatch(),
            items: makeBatch().items.map((i) => ({ ...i, selected: false })),
          },
        ],
      });
      useChatStore.getState().setBatchItemsSelected('batch-1', true);
      const items = useChatStore.getState().pendingConfirms[0].items;
      expect(items.every((i) => i.selected)).toBe(true);
    });

    it('deselects all items', () => {
      useChatStore.setState({ pendingConfirms: [makeBatch()] });
      useChatStore.getState().setBatchItemsSelected('batch-1', false);
      const items = useChatStore.getState().pendingConfirms[0].items;
      expect(items.every((i) => !i.selected)).toBe(true);
    });
  });

  describe('removeBatchItem', () => {
    it('drops the targeted item only', () => {
      useChatStore.setState({ pendingConfirms: [makeBatch()] });
      useChatStore.getState().removeBatchItem('batch-1', 'c2');
      const items = useChatStore.getState().pendingConfirms[0].items;
      expect(items.map((i) => i.callId)).toEqual(['c1', 'c3']);
    });
  });

  describe('cancelBatch', () => {
    it("marks the batch status as 'done' without removing it", () => {
      useChatStore.setState({
        pendingConfirms: [makeBatch(), makeBatch({ id: 'batch-2' })],
      });
      useChatStore.getState().cancelBatch('batch-1');
      const all = useChatStore.getState().pendingConfirms;
      expect(all).toHaveLength(2);
      expect(all.find((b) => b.id === 'batch-1')?.status).toBe('done');
      expect(all.find((b) => b.id === 'batch-2')?.status).toBe('awaiting_confirm');
    });

    it('is a no-op for unknown batch id (other batches unaffected)', () => {
      useChatStore.setState({ pendingConfirms: [makeBatch()] });
      useChatStore.getState().cancelBatch('nope');
      expect(useChatStore.getState().pendingConfirms[0].status).toBe('awaiting_confirm');
    });
  });

  describe('markSessionViewed', () => {
    it('clears unreadCount when viewing the general session', () => {
      useChatStore.setState({
        unreadCount: 3,
        generalSession: {
          id: 'sess-A',
          scope: { kind: 'general' },
          messages: [],
          messageCount: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          createdAt: 0,
          updatedAt: 0,
        },
      });
      useChatStore.getState().markSessionViewed('sess-A');
      expect(useChatStore.getState().unreadCount).toBe(0);
    });

    it('does NOT clear unreadCount when viewing a non-general session', () => {
      useChatStore.setState({
        unreadCount: 3,
        generalSession: {
          id: 'sess-A',
          scope: { kind: 'general' },
          messages: [],
          messageCount: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          createdAt: 0,
          updatedAt: 0,
        },
      });
      useChatStore.getState().markSessionViewed('sess-other');
      expect(useChatStore.getState().unreadCount).toBe(3);
    });
  });

  describe('dropContextSession', () => {
    it('removes the context-scoped session by scope', () => {
      useChatStore.setState({
        contextSessions: {
          'word:w1': {
            id: 'sess-1',
            scope: { kind: 'word', wordId: 'w1' },
            messages: [],
            messageCount: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            createdAt: 0,
            updatedAt: 0,
          },
          'word:w2': {
            id: 'sess-2',
            scope: { kind: 'word', wordId: 'w2' },
            messages: [],
            messageCount: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            createdAt: 0,
            updatedAt: 0,
          },
        },
      });
      useChatStore.getState().dropContextSession({ kind: 'word', wordId: 'w1' });
      const keys = Object.keys(useChatStore.getState().contextSessions);
      expect(keys).toEqual(['word:w2']);
    });

    it('is a no-op for the general scope', () => {
      useChatStore.setState({
        contextSessions: {
          'word:w1': {
            id: 'sess-1',
            scope: { kind: 'word', wordId: 'w1' },
            messages: [],
            messageCount: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            createdAt: 0,
            updatedAt: 0,
          },
        },
      });
      useChatStore.getState().dropContextSession({ kind: 'general' });
      expect(Object.keys(useChatStore.getState().contextSessions)).toEqual(['word:w1']);
    });
  });

  describe('getSessionByScope', () => {
    it('returns the general session for {kind: general}', () => {
      const gen = {
        id: 'g',
        scope: { kind: 'general' as const },
        messages: [],
        messageCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        createdAt: 0,
        updatedAt: 0,
      };
      useChatStore.setState({ generalSession: gen });
      expect(useChatStore.getState().getSessionByScope({ kind: 'general' })?.id).toBe('g');
    });

    it('returns the context session by composite key', () => {
      const sess = {
        id: 'wb-x',
        scope: { kind: 'wordbook' as const, wordbookId: 'x' },
        messages: [],
        messageCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        createdAt: 0,
        updatedAt: 0,
      };
      useChatStore.setState({ contextSessions: { 'wordbook:x': sess } });
      const found = useChatStore
        .getState()
        .getSessionByScope({ kind: 'wordbook', wordbookId: 'x' });
      expect(found?.id).toBe('wb-x');
    });

    it('returns null when no session matches the scope', () => {
      const found = useChatStore
        .getState()
        .getSessionByScope({ kind: 'quiz', sessionId: 'noop' });
      expect(found).toBeNull();
    });
  });
});
