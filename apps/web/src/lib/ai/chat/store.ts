'use client';

/**
 * Chat store — app-shell-mounted Zustand store.
 *
 * Mirrors the scan-store pattern: long-running native work continues across
 * navigation, MobileShell subscribes for cross-page toasts and badge counts,
 * and bridge events are routed into this store from a single listener
 * installed at the layout root.
 *
 * Responsibilities:
 *  - Hydrate / persist the user's single rolling `general` session (Phase 1
 *    UI policy; the schema already supports multi-session).
 *  - Hold volatile context-scoped sessions in memory.
 *  - Track active inference (requestId, abort controller, streaming message).
 *  - Aggregate pending tool-call batches awaiting user confirmation.
 *  - Surface `unreadCount` for the assistant footer-tab badge.
 */

import { create } from 'zustand';
import { toast } from 'sonner';
import type { DataRepository } from '@/lib/repository/types';
import { recordMetric } from './metrics';
import { storeAttachment } from './attachments';
import { streamInfer, cancelInfer } from './inference';
import { buildSystemPrompt, trimHistoryToBudget } from './prompts';
import { getTool, getToolDefsForBridge, type ToolContext } from './tools';
import { getSaveQuizAiSessions } from '../assistant-prefs';
import type {
  AiInferMessage,
  AiInferContentBlock,
} from '@/lib/native-bridge';
import type {
  ChatContentBlock,
  ChatMessage,
  ChatScope,
  ChatSession,
  PendingToolBatch,
  PendingToolBatchItem,
} from '@/types/chat';

interface ActiveInference {
  sessionId: string;
  requestId: string;
  startedAt: number;
  streamingMessageId: string;
  abortController: AbortController;
}

interface ChatStoreState {
  generalSession: ChatSession | null;
  contextSessions: Record<string, ChatSession>;
  activeInference: ActiveInference | null;
  pendingConfirms: PendingToolBatch[];
  lastViewedAt: Record<string, number>;
  unreadCount: number;
  hydrated: boolean;
  /** Locale used for prompt-building. Updated by app shell. */
  locale: string;
  /** Repository injected by app shell on mount. */
  _repo: DataRepository | null;

  // Setup
  init(repo: DataRepository, locale: string): Promise<void>;
  setLocale(locale: string): void;

  // Session management
  getSessionByScope(scope: ChatScope): ChatSession | null;
  ensureSession(scope: ChatScope): Promise<ChatSession>;
  clearGeneralSession(): Promise<void>;
  dropContextSession(scope: ChatScope): void;
  markSessionViewed(sessionId: string): void;
  /** List all persisted general sessions (most recent first). DB-backed. */
  listGeneralSessions(limit?: number): Promise<ChatSession[]>;
  /** Load a past session by id and set it as the active general session. */
  loadGeneralSession(sessionId: string): Promise<void>;
  /** Start a new general session, leaving past sessions in DB. */
  startNewGeneralSession(): Promise<void>;
  /** Delete a session (and its messages) from the DB. */
  deleteGeneralSession(sessionId: string): Promise<void>;
  /** Rename a session (auto-title or user override). */
  renameGeneralSession(sessionId: string, title: string): Promise<void>;

  // Messaging
  sendMessage(scope: ChatScope, blocks: ChatContentBlock[]): Promise<void>;
  cancelActiveInference(): void;

  // Tool confirmations
  toggleBatchItem(batchId: string, callId: string): void;
  setBatchItemsSelected(batchId: string, selected: boolean): void;
  removeBatchItem(batchId: string, callId: string): void;
  approveBatch(batchId: string): Promise<void>;
  cancelBatch(batchId: string): void;

  // Feedback
  setMessageFeedback(
    messageId: string,
    feedback: 'thumbs_up' | 'thumbs_down' | null,
  ): Promise<void>;

  /**
   * Opportunistically generate an auto-summary of older messages when the
   * session is approaching the token budget. Runs a background inference
   * call. Idempotent: returns immediately if the session is already short
   * enough or a summary is in flight.
   */
  summarizeIfNeeded(sessionId: string): Promise<void>;
}

function scopeKey(scope: ChatScope): string {
  if (scope.kind === 'general') return 'general';
  if (scope.kind === 'word') return `word:${scope.wordId}`;
  if (scope.kind === 'wordbook') return `wordbook:${scope.wordbookId}`;
  return `quiz:${scope.sessionId}`;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Tracks in-flight summarization per session id (module-level). */
const summarizeInflight = new Set<string>();

/**
 * Returns true when a session of the given scope should be persisted to the
 * `ai_sessions` / `ai_messages` tables.
 *  - General: always (single rolling user session).
 *  - Quiz: only if the user has opted in via `assistant-prefs`.
 *  - Word / wordbook context: never (ephemeral by design).
 */
function shouldPersistScope(scope: ChatScope): boolean {
  if (scope.kind === 'general') return true;
  if (scope.kind === 'quiz') return getSaveQuizAiSessions();
  return false;
}

function isMutating(toolName: string): boolean {
  const tool = getTool(toolName);
  return tool?.mutates ?? true;
}

function newSession(scope: ChatScope): ChatSession {
  const now = Date.now();
  return {
    id: uuid(),
    scope,
    messages: [],
    messageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function chatBlocksToBridgeBlocks(
  blocks: ChatContentBlock[],
  attachmentSources: Record<string, string>,
): AiInferContentBlock[] {
  const out: AiInferContentBlock[] = [];
  for (const b of blocks) {
    if (b.type === 'text') out.push({ type: 'text', text: b.text });
    else if (b.type === 'image') {
      const src = attachmentSources[b.attachmentId];
      if (src) out.push({ type: 'image', source: src });
    } else if (b.type === 'audio') {
      const src = attachmentSources[b.attachmentId];
      if (src) out.push({ type: 'audio', source: src, mimeType: b.mimeType });
    } else if (b.type === 'tool_result') {
      out.push({
        type: 'tool_result',
        toolName: b.toolName,
        toolCallId: b.toolCallId,
        result: b.result,
      });
    }
  }
  return out;
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  generalSession: null,
  contextSessions: {},
  activeInference: null,
  pendingConfirms: [],
  lastViewedAt: {},
  unreadCount: 0,
  hydrated: false,
  locale: 'ko',
  _repo: null,

  init: async (repo, locale) => {
    set({ _repo: repo, locale });
    try {
      const existing = await repo.chat.getCurrentSession();
      if (existing) {
        set({ generalSession: existing });
      }
    } catch {
      // LOGIN_REQUIRED (guest) — keep null; assistant page falls back.
    }
    set({ hydrated: true });
  },

  setLocale: (locale) => set({ locale }),

  getSessionByScope: (scope) => {
    if (scope.kind === 'general') return get().generalSession;
    return get().contextSessions[scopeKey(scope)] ?? null;
  },

  ensureSession: async (scope) => {
    const existing = get().getSessionByScope(scope);
    if (existing) return existing;

    if (scope.kind === 'general') {
      const repo = get()._repo;
      if (!repo) throw new Error('Repository not initialized');
      try {
        const created = await repo.chat.createSession(scope);
        set({ generalSession: created });
        return created;
      } catch {
        const fallback = newSession(scope);
        set({ generalSession: fallback });
        return fallback;
      }
    }

    // Quiz scope with "save sessions" toggle ON → create a real DB session so
    // subsequent appendMessage calls have a parent. Word / wordbook scopes
    // remain in-memory only by design.
    let session = newSession(scope);
    if (shouldPersistScope(scope)) {
      const repo = get()._repo;
      if (repo) {
        try {
          session = await repo.chat.createSession(scope);
        } catch {
          // Fall through to the in-memory session if the DB call fails.
        }
      }
    }
    set((s) => ({
      contextSessions: { ...s.contextSessions, [scopeKey(scope)]: session },
    }));
    return session;
  },

  clearGeneralSession: async () => {
    const repo = get()._repo;
    if (repo) {
      try {
        await repo.chat.clearAllSessions();
      } catch {
        // ignore — local clear still happens
      }
    }
    set({
      generalSession: null,
      pendingConfirms: get().pendingConfirms.filter((b) => {
        // Drop confirms tied to messages we just dropped
        const gen = get().generalSession;
        return gen ? gen.messages.some((m) => m.id === b.messageId) : false;
      }),
      unreadCount: 0,
    });
  },

  dropContextSession: (scope) => {
    if (scope.kind === 'general') return;
    const key = scopeKey(scope);
    set((s) => {
      const { [key]: _dropped, ...rest } = s.contextSessions;
      return { contextSessions: rest };
    });
  },

  markSessionViewed: (sessionId) => {
    set((s) => ({
      lastViewedAt: { ...s.lastViewedAt, [sessionId]: Date.now() },
      // Recompute unread for general session only — context sessions don't badge.
      unreadCount:
        s.generalSession?.id === sessionId ? 0 : s.unreadCount,
    }));
  },

  listGeneralSessions: async (limit = 20) => {
    const repo = get()._repo;
    if (!repo) return [];
    try {
      return await repo.chat.listSessions(limit);
    } catch {
      return [];
    }
  },

  loadGeneralSession: async (sessionId) => {
    const repo = get()._repo;
    if (!repo) return;
    const sessions = await repo.chat.listSessions(50);
    const found = sessions.find((s) => s.id === sessionId);
    if (!found) return;
    // listSessions does NOT include messages — fetch them.
    const messages = await repo.chat.listMessages(sessionId, 200);
    set({
      generalSession: { ...found, messages, messageCount: messages.length },
      pendingConfirms: [],
    });
  },

  startNewGeneralSession: async () => {
    // Drop the local handle; a fresh session is lazily created on next send.
    set({ generalSession: null, pendingConfirms: [], unreadCount: 0 });
  },

  deleteGeneralSession: async (sessionId) => {
    const repo = get()._repo;
    if (!repo) return;
    try {
      await repo.chat.deleteSession(sessionId);
    } catch {
      // ignore
    }
    // If the deleted session was the active one, clear local state.
    if (get().generalSession?.id === sessionId) {
      set({ generalSession: null, pendingConfirms: [], unreadCount: 0 });
    }
  },

  renameGeneralSession: async (sessionId, title) => {
    const repo = get()._repo;
    if (!repo) return;
    try {
      await repo.chat.updateSessionTitle(sessionId, title);
    } catch {
      // ignore
    }
    set((s) => ({
      generalSession:
        s.generalSession && s.generalSession.id === sessionId
          ? { ...s.generalSession, title }
          : s.generalSession,
    }));
  },

  sendMessage: async (scope, blocks) => {
    const repo = get()._repo;
    if (!repo) throw new Error('Repository not initialized');

    const session = await get().ensureSession(scope);
    const locale = get().locale;

    // Resolve attachment sources for image/audio blocks to data URLs.
    // The blob URLs (`blob:http://...`) the input bar generates are renderer-
    // only — native code can't fetch them — so we read each blob out of
    // IndexedDB and inline it as `data:` for the bridge.
    const attachmentSources: Record<string, string> = {};
    const attBlocks = blocks.filter(
      (b): b is Extract<ChatContentBlock, { type: 'image' | 'audio' }> =>
        b.type === 'image' || b.type === 'audio',
    );
    if (attBlocks.length > 0) {
      const { getAttachment, blobToDataUrl } = await import('./attachments');
      await Promise.all(
        attBlocks.map(async (b) => {
          const blob = await getAttachment(b.attachmentId);
          if (blob) {
            attachmentSources[b.attachmentId] = await blobToDataUrl(blob);
          }
        }),
      );
    }

    // Empty blocks = continuation trigger (e.g., after tool batch approval).
    // Skip adding a user message in that case.
    const isContinuation = blocks.length === 0;

    const userMessage: ChatMessage | null = isContinuation
      ? null
      : {
          id: uuid(),
          sessionId: session.id,
          role: 'user',
          content: blocks,
          status: 'complete',
          attachmentIds: blocks
            .filter((b): b is Extract<ChatContentBlock, { type: 'image' }> => b.type === 'image')
            .map((b) => b.attachmentId),
          createdAt: Date.now(),
        };

    const assistantMessage: ChatMessage = {
      id: uuid(),
      sessionId: session.id,
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      toolCalls: [],
      status: 'streaming',
      createdAt: Date.now() + 1,
    };

    // Optimistic local insert.
    set((s) => {
      const updateSession = (sess: ChatSession): ChatSession => ({
        ...sess,
        messages: userMessage
          ? [...sess.messages, userMessage, assistantMessage]
          : [...sess.messages, assistantMessage],
        messageCount: sess.messageCount + (userMessage ? 2 : 1),
        lastMessageAt: assistantMessage.createdAt,
        updatedAt: assistantMessage.createdAt,
      });
      if (scope.kind === 'general' && s.generalSession) {
        return { generalSession: updateSession(s.generalSession) };
      }
      const key = scopeKey(scope);
      const cur = s.contextSessions[key];
      if (!cur) return {};
      return {
        contextSessions: { ...s.contextSessions, [key]: updateSession(cur) },
      };
    });

    // Persist user message (general always, quiz when toggle ON, skip continuation).
    if (shouldPersistScope(scope) && userMessage) {
      try {
        await repo.chat.appendMessage(userMessage);
      } catch {
        // ignore — UI already shows it
      }
      // Auto-title: the first user message in a session becomes its title
      // (truncated). Fire-and-forget; users can rename later.
      if (
        scope.kind === 'general' &&
        !session.title &&
        session.messageCount === 0
      ) {
        const firstText = userMessage.content.find(
          (b): b is Extract<ChatContentBlock, { type: 'text' }> => b.type === 'text',
        )?.text;
        if (firstText) {
          const title = firstText.length > 40 ? firstText.slice(0, 40) + '…' : firstText;
          repo.chat.updateSessionTitle(session.id, title).catch(() => {});
          set((s) => ({
            generalSession:
              s.generalSession?.id === session.id
                ? { ...s.generalSession, title }
                : s.generalSession,
          }));
        }
      }
    }

    void recordMetric('chat.message_sent', {
      scope: scope.kind,
      hasImage: blocks.some((b) => b.type === 'image'),
      charCount: blocks.reduce(
        (acc, b) => (b.type === 'text' ? acc + b.text.length : acc),
        0,
      ),
    });

    // Build the request payload.
    const basePrompt = await buildSystemPrompt(scope, repo, locale);
    const tools = getToolDefsForBridge();
    const toolsJson = JSON.stringify(tools);

    const sessNow = get().getSessionByScope(scope)!;

    // Auto-summary: if a past context summary covers older messages, splice
    // it onto the system prompt and skip those messages in the live history.
    const summary = sessNow.contextSummary;
    const summarizedThroughId = sessNow.summarizedThroughMessageId;
    const systemPrompt = summary
      ? `${basePrompt}\n\n[Summary of earlier conversation]\n${summary}`
      : basePrompt;

    // priorMessages = all messages except the streaming placeholder we just inserted.
    const allPrior = sessNow.messages.slice(0, -1);
    const summarizedThroughIdx = summarizedThroughId
      ? allPrior.findIndex((m) => m.id === summarizedThroughId)
      : -1;
    const liveMessages = summarizedThroughIdx >= 0
      ? allPrior.slice(summarizedThroughIdx + 1)
      : allPrior;

    const fullHistory: AiInferMessage[] = [];
    const bridgeMessages: AiInferMessage[] = liveMessages.map((m) => ({
      role: m.role === 'tool' ? 'tool' : m.role,
      content: chatBlocksToBridgeBlocks(m.content, attachmentSources),
    }));
    const { kept, truncated } = trimHistoryToBudget(systemPrompt, toolsJson, bridgeMessages);
    fullHistory.push({ role: 'system', content: [{ type: 'text', text: systemPrompt }] });
    fullHistory.push(...kept);

    if (truncated) {
      void recordMetric('chat.context_truncated', { scope: scope.kind });
    }

    const requestId = uuid();
    const abortController = new AbortController();
    set({
      activeInference: {
        sessionId: session.id,
        requestId,
        startedAt: Date.now(),
        streamingMessageId: assistantMessage.id,
        abortController,
      },
    });

    void recordMetric('chat.inference_start', {
      scope: scope.kind,
      historyTurns: liveMessages.length,
    });

    let aggregatedText = '';
    let readOnlyToolCount = 0;
    const writeBucketsByName = new Map<string, PendingToolBatchItem[]>();

    const startedAt = Date.now();
    try {
      for await (const event of streamInfer(
        { messages: fullHistory, tools },
        abortController.signal,
      )) {
        if (event.type === 'text_delta') {
          aggregatedText += event.text;
          // Append to streaming assistant content
          set((s) => {
            const apply = (sess: ChatSession): ChatSession => ({
              ...sess,
              messages: sess.messages.map((m) =>
                m.id === assistantMessage.id
                  ? { ...m, content: [{ type: 'text', text: aggregatedText }] }
                  : m,
              ),
            });
            if (scope.kind === 'general' && s.generalSession) {
              return { generalSession: apply(s.generalSession) };
            }
            const key = scopeKey(scope);
            const cur = s.contextSessions[key];
            if (!cur) return {};
            return { contextSessions: { ...s.contextSessions, [key]: apply(cur) } };
          });
        } else if (event.type === 'tool_call') {
          void recordMetric('chat.tool_call_parsed', {
            toolName: event.name,
            mutating: isMutating(event.name),
          });
          const callId = uuid();
          if (isMutating(event.name)) {
            const bucket = writeBucketsByName.get(event.name) ?? [];
            bucket.push({
              callId,
              args: event.args,
              selected: true,
              status: 'pending',
            });
            writeBucketsByName.set(event.name, bucket);
          } else {
            // Auto-execute read-only.
            const tool = getTool(event.name);
            if (tool) {
              const ctx: ToolContext = { repo, locale };
              try {
                const result = await tool.execute(event.args, ctx);
                readOnlyToolCount++;
                // Append a tool_result message to history so the next turn can use it.
                const toolResultMsg: ChatMessage = {
                  id: uuid(),
                  sessionId: session.id,
                  role: 'tool',
                  content: [
                    {
                      type: 'tool_result',
                      toolName: event.name,
                      toolCallId: callId,
                      result,
                    },
                  ],
                  status: 'complete',
                  createdAt: Date.now(),
                };
                set((s) => {
                  const apply = (sess: ChatSession): ChatSession => ({
                    ...sess,
                    messages: [...sess.messages, toolResultMsg],
                  });
                  if (scope.kind === 'general' && s.generalSession) {
                    return { generalSession: apply(s.generalSession) };
                  }
                  const key = scopeKey(scope);
                  const cur = s.contextSessions[key];
                  if (!cur) return {};
                  return {
                    contextSessions: { ...s.contextSessions, [key]: apply(cur) },
                  };
                });
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                readOnlyToolCount++;
                console.error(`read-only tool ${event.name} failed: ${message}`);
              }
            }
          }
        } else if (event.type === 'done') {
          // Finalize assistant message.
          set((s) => {
            const apply = (sess: ChatSession): ChatSession => ({
              ...sess,
              messages: sess.messages.map((m) =>
                m.id === assistantMessage.id
                  ? {
                      ...m,
                      content: [{ type: 'text', text: aggregatedText }],
                      status: 'complete',
                      finishReason: event.finishReason,
                      inputTokens: event.inputTokens,
                      outputTokens: event.outputTokens,
                      modelVariant: event.modelVariant as ChatMessage['modelVariant'],
                    }
                  : m,
              ),
              totalInputTokens: sess.totalInputTokens + (event.inputTokens ?? 0),
              totalOutputTokens: sess.totalOutputTokens + (event.outputTokens ?? 0),
            });
            if (scope.kind === 'general' && s.generalSession) {
              return { generalSession: apply(s.generalSession) };
            }
            const key = scopeKey(scope);
            const cur = s.contextSessions[key];
            if (!cur) return {};
            return { contextSessions: { ...s.contextSessions, [key]: apply(cur) } };
          });

          // Flush mutating tool batches as confirm cards.
          if (writeBucketsByName.size > 0) {
            const newBatches: PendingToolBatch[] = [];
            for (const [toolName, items] of writeBucketsByName) {
              newBatches.push({
                id: uuid(),
                messageId: assistantMessage.id,
                toolName,
                items,
                status: 'awaiting_confirm',
              });
            }
            set((s) => ({
              pendingConfirms: [...s.pendingConfirms, ...newBatches],
            }));
          }

          // Update unread count if not on the assistant page.
          set((s) => {
            // Only general sessions contribute to the assistant-tab unread badge.
            if (scope.kind !== 'general') return s;
            const lastViewed = s.lastViewedAt[session.id] ?? 0;
            const isViewing = Date.now() - lastViewed < 5_000;
            return isViewing ? s : { unreadCount: s.unreadCount + 1 };
          });

          void recordMetric('chat.inference_done', {
            scope: scope.kind,
            durationMs: Date.now() - startedAt,
            outputTokens: event.outputTokens,
            finishReason: event.finishReason,
            toolCallCount: writeBucketsByName.size + readOnlyToolCount,
          });

          if (shouldPersistScope(scope)) {
            // Persist assistant message (final form).
            try {
              await repo.chat.appendMessage({
                ...assistantMessage,
                content: [{ type: 'text', text: aggregatedText }],
                status: 'complete',
                finishReason: event.finishReason,
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
              });
            } catch {
              // ignore
            }
          }

          // Opportunistic background summarization for general sessions —
          // runs only if there's enough new content to bother. Fire-and-forget.
          if (scope.kind === 'general') {
            void get().summarizeIfNeeded(session.id);
          }
        } else if (event.type === 'error') {
          // Mark assistant message as failed.
          set((s) => {
            const apply = (sess: ChatSession): ChatSession => ({
              ...sess,
              messages: sess.messages.map((m) =>
                m.id === assistantMessage.id
                  ? {
                      ...m,
                      status: 'failed',
                      errorCode: event.code,
                      errorMessage: event.message,
                    }
                  : m,
              ),
            });
            if (scope.kind === 'general' && s.generalSession) {
              return { generalSession: apply(s.generalSession) };
            }
            const key = scopeKey(scope);
            const cur = s.contextSessions[key];
            if (!cur) return {};
            return { contextSessions: { ...s.contextSessions, [key]: apply(cur) } };
          });
          void recordMetric('chat.inference_error', {
            scope: scope.kind,
            code: event.code,
            durationMs: Date.now() - startedAt,
          });
          if (shouldPersistScope(scope)) {
            try {
              await repo.chat.updateMessageStatus(assistantMessage.id, 'failed', {
                errorCode: event.code,
                errorMessage: event.message,
              });
            } catch {
              // ignore
            }
          }
        }
      }
    } catch (err) {
      // AbortError lands here — already handled by activeInference cancel path.
      const isAbort =
        err instanceof DOMException && err.name === 'AbortError';
      if (!isAbort) {
        console.error('chat sendMessage failed', err);
      }
    } finally {
      set((s) => {
        if (s.activeInference?.requestId === requestId) {
          return { activeInference: null };
        }
        return s;
      });
    }
  },

  cancelActiveInference: () => {
    const active = get().activeInference;
    if (!active) return;
    active.abortController.abort();
    cancelInfer(active.requestId);
    void recordMetric('chat.cancelled_by_user', { requestId: active.requestId });
  },

  toggleBatchItem: (batchId, callId) => {
    set((s) => ({
      pendingConfirms: s.pendingConfirms.map((b) =>
        b.id === batchId
          ? {
              ...b,
              items: b.items.map((it) =>
                it.callId === callId ? { ...it, selected: !it.selected } : it,
              ),
            }
          : b,
      ),
    }));
  },

  setBatchItemsSelected: (batchId, selected) => {
    set((s) => ({
      pendingConfirms: s.pendingConfirms.map((b) =>
        b.id === batchId ? { ...b, items: b.items.map((it) => ({ ...it, selected })) } : b,
      ),
    }));
  },

  removeBatchItem: (batchId, callId) => {
    set((s) => ({
      pendingConfirms: s.pendingConfirms.map((b) =>
        b.id === batchId ? { ...b, items: b.items.filter((it) => it.callId !== callId) } : b,
      ),
    }));
  },

  approveBatch: async (batchId) => {
    const batch = get().pendingConfirms.find((b) => b.id === batchId);
    if (!batch) return;
    const repo = get()._repo;
    const locale = get().locale;
    if (!repo) return;

    const tool = getTool(batch.toolName);
    if (!tool) {
      toast.error(`Unknown tool: ${batch.toolName}`);
      return;
    }

    set((s) => ({
      pendingConfirms: s.pendingConfirms.map((b) =>
        b.id === batchId
          ? {
              ...b,
              status: 'running',
              items: b.items.map((it) =>
                it.selected ? { ...it, status: 'running' } : it,
              ),
            }
          : b,
      ),
    }));

    const ctx: ToolContext = { repo, locale };
    const executed: Array<{ callId: string; args: Record<string, unknown>; result: unknown }> = [];
    const failed: Array<{ callId: string; args: Record<string, unknown>; error: string }> = [];
    const skipped: Array<{ callId: string; args: Record<string, unknown> }> = [];

    for (const item of batch.items) {
      if (!item.selected) {
        skipped.push({ callId: item.callId, args: item.args });
        continue;
      }
      const started = Date.now();
      try {
        const result = await tool.execute(item.args, ctx);
        executed.push({ callId: item.callId, args: item.args, result });
        void recordMetric('chat.tool_call_executed', {
          toolName: batch.toolName,
          durationMs: Date.now() - started,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failed.push({ callId: item.callId, args: item.args, error: msg });
        void recordMetric('chat.tool_call_failed', {
          toolName: batch.toolName,
          error: msg,
        });
      }
    }

    // Update batch state.
    set((s) => ({
      pendingConfirms: s.pendingConfirms.map((b) =>
        b.id === batchId
          ? {
              ...b,
              status: 'done',
              items: b.items.map((it) => {
                if (!it.selected) return { ...it, status: 'pending' };
                const f = failed.find((x) => x.callId === it.callId);
                const e = executed.find((x) => x.callId === it.callId);
                if (f) return { ...it, status: 'failed', error: f.error };
                if (e) return { ...it, status: 'done', result: e.result };
                return it;
              }),
            }
          : b,
      ),
    }));

    void recordMetric('chat.tool_batch_executed', {
      toolName: batch.toolName,
      executedCount: executed.length,
      failedCount: failed.length,
      skippedCount: skipped.length,
    });

    // Append a `tool_result` message and re-trigger inference for the
    // assistant follow-up. We attribute the new tool_result to the session
    // that owns the batch's parent message.
    const allSessions: ChatSession[] = [];
    const gen = get().generalSession;
    if (gen) allSessions.push(gen);
    for (const s of Object.values(get().contextSessions)) allSessions.push(s);
    const parent = allSessions.find((sess) =>
      sess.messages.some((m) => m.id === batch.messageId),
    );
    if (!parent) return;

    const toolResultMsg: ChatMessage = {
      id: uuid(),
      sessionId: parent.id,
      role: 'tool',
      content: [
        {
          type: 'tool_result',
          toolName: batch.toolName,
          toolCallId: batch.id,
          result: {
            tool: batch.toolName,
            batch_id: batch.id,
            executed: executed.map((e) => ({ args: e.args, result: e.result })),
            failed: failed.map((f) => ({ args: f.args, error: f.error })),
            skipped_by_user: skipped.map((s) => ({ args: s.args, reason: 'deselected' })),
          },
        },
      ],
      status: 'complete',
      createdAt: Date.now(),
    };

    set((s) => {
      const apply = (sess: ChatSession): ChatSession =>
        sess.id === parent.id
          ? { ...sess, messages: [...sess.messages, toolResultMsg] }
          : sess;
      const next: Partial<ChatStoreState> = {};
      if (s.generalSession) next.generalSession = apply(s.generalSession);
      const ctxUpdate: Record<string, ChatSession> = { ...s.contextSessions };
      for (const k of Object.keys(ctxUpdate)) {
        ctxUpdate[k] = apply(ctxUpdate[k]);
      }
      next.contextSessions = ctxUpdate;
      return next;
    });

    // Re-trigger inference so the AI summarizes the result.
    await get().sendMessage(parent.scope, []);
  },

  cancelBatch: (batchId) => {
    set((s) => ({
      pendingConfirms: s.pendingConfirms.map((b) =>
        b.id === batchId
          ? {
              ...b,
              status: 'done',
              items: b.items.map((it) => ({ ...it, status: 'pending' })),
            }
          : b,
      ),
    }));
  },

  summarizeIfNeeded: async (sessionId) => {
    const session = get().generalSession?.id === sessionId
      ? get().generalSession
      : null;
    if (!session) return;

    // Threshold: only summarize when we have a meaningful number of messages
    // past the current summary cutoff. Keep the most recent 4 turns verbatim.
    const KEEP_RECENT = 4;
    const summarizedIdx = session.summarizedThroughMessageId
      ? session.messages.findIndex((m) => m.id === session.summarizedThroughMessageId)
      : -1;
    const candidates = session.messages.slice(summarizedIdx + 1, -KEEP_RECENT);
    if (candidates.length < 4) return; // not enough to summarize

    // Estimate tokens to skip work when the live history would fit anyway.
    const candidateText = candidates
      .flatMap((m) => m.content.map((b) => (b.type === 'text' ? b.text : '')))
      .join(' ');
    if (candidateText.length < 800) return; // ~200 tokens, not worth a round-trip

    if (summarizeInflight.has(sessionId)) return;
    summarizeInflight.add(sessionId);

    try {
      const repo = get()._repo;
      if (!repo) return;
      const locale = get().locale;
      const prevSummary = session.contextSummary;

      // Stitch candidates + prior summary into a single string to compress.
      const transcript = candidates
        .map((m) => {
          const text = m.content
            .filter((b): b is Extract<ChatContentBlock, { type: 'text' }> => b.type === 'text')
            .map((b) => b.text)
            .join('\n');
          return `[${m.role}] ${text}`;
        })
        .join('\n\n');

      const systemPrompt = locale === 'ko'
        ? '당신은 대화 요약자입니다. 다음 대화를 한국어로 5문장 이내로 요약하세요. 사용자가 추가/수정/삭제한 단어, 단어장 이름, 결정 사항을 사실 중심으로 보존하세요. 잡담은 생략.'
        : 'You are a conversation summarizer. Summarize the conversation in <=5 sentences. Preserve facts about words added/edited/deleted, wordbook names, and decisions. Skip small talk.';

      const userText = prevSummary
        ? `Previous summary:\n${prevSummary}\n\nNew messages:\n${transcript}\n\nProduce an updated summary.`
        : `Conversation:\n${transcript}\n\nProduce a summary.`;

      let summary = '';
      const requestId = uuid();
      const gen = streamInfer(
        {
          messages: [
            { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
            { role: 'user', content: [{ type: 'text', text: userText }] },
          ],
          tools: [],
          options: { maxOutputTokens: 280 },
        },
        // No abort signal — fire-and-forget; the user can keep chatting.
      );
      void requestId;
      for await (const event of gen) {
        if (event.type === 'text_delta') summary += event.text;
        else if (event.type === 'done' || event.type === 'error') break;
      }
      summary = summary.trim();
      if (!summary) return;

      const lastIncludedId = candidates[candidates.length - 1].id;
      const newSummarizedCount = (session.summarizedMessageCount ?? 0) + candidates.length;

      // Persist (general only).
      if (session.scope.kind === 'general') {
        try {
          await repo.chat.setSessionSummary(
            session.id,
            summary,
            lastIncludedId,
            newSummarizedCount,
          );
        } catch {
          /* ignore — keep local copy */
        }
      }
      set((s) => ({
        generalSession:
          s.generalSession?.id === session.id
            ? {
                ...s.generalSession,
                contextSummary: summary,
                summarizedThroughMessageId: lastIncludedId,
                summarizedMessageCount: newSummarizedCount,
              }
            : s.generalSession,
      }));
      void recordMetric('chat.context_summarized', {
        addedCount: candidates.length,
        totalSummarized: newSummarizedCount,
      });
    } catch (err) {
      console.warn('[chat] summarize failed', err);
    } finally {
      summarizeInflight.delete(sessionId);
    }
  },

  setMessageFeedback: async (messageId, feedback) => {
    // Optimistic local patch — find the message in either general or any
    // context session and update its `feedback` field.
    set((s) => {
      const patchSession = (sess: ChatSession): ChatSession => ({
        ...sess,
        messages: sess.messages.map((m) =>
          m.id === messageId ? { ...m, feedback: feedback ?? undefined } : m,
        ),
      });
      const next: Partial<ChatStoreState> = {};
      if (s.generalSession) next.generalSession = patchSession(s.generalSession);
      const ctxUpdate: Record<string, ChatSession> = { ...s.contextSessions };
      for (const k of Object.keys(ctxUpdate)) ctxUpdate[k] = patchSession(ctxUpdate[k]);
      next.contextSessions = ctxUpdate;
      return next;
    });
    // Persist to DB (general sessions + quiz when toggle ON). Quiz/word/wordbook
    // ephemeral sessions silently swallow the LOGIN_REQUIRED.
    const repo = get()._repo;
    if (!repo) return;
    try {
      await repo.chat.setMessageFeedback(messageId, feedback);
    } catch {
      // Ephemeral session or transient failure — local state stays patched.
    }
  },
}));

// Re-export for convenience.
export { storeAttachment };
