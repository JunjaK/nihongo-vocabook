/**
 * Shared types for the AI Assistant chat feature.
 *
 * Volatile (in-memory only) scopes — word / wordbook / quiz — are modeled here
 * for completeness, but only `general` scope is persisted to Supabase. See
 * `_docs/ai-assistant-and-footer-redesign.md` for the full design.
 */

export type ChatRole = 'user' | 'assistant' | 'tool' | 'system';

export type ChatMessageStatus =
  | 'streaming'
  | 'complete'
  | 'truncated'
  | 'cancelled'
  | 'failed';

export type ChatFinishReason = 'stop' | 'length' | 'tool_call' | 'error';

export type ChatModelVariant = 'gemma-4-e2b' | 'gemma-4-e4b';

export type ChatScope =
  | { kind: 'general' }
  | { kind: 'word'; wordId: string }
  | { kind: 'wordbook'; wordbookId: string }
  | { kind: 'quiz'; sessionId: string; currentWordId?: string; lastRating?: number };

export type ChatContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; attachmentId: string; previewUrl?: string }
  | {
      type: 'tool_result';
      toolName: string;
      toolCallId: string;
      result: unknown;
      error?: string;
    };

export type ToolCallStatus =
  | 'awaiting_confirm'
  | 'running'
  | 'done'
  | 'cancelled'
  | 'failed'
  | 'skipped_by_user';

export interface PendingToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolCallStatus;
  result?: unknown;
  error?: string;
  mutates: boolean;
}

/**
 * Aggregated batch of same-tool calls within one assistant turn. Rendered as
 * a single multi-select confirmation card in the UI.
 */
export interface PendingToolBatch {
  id: string;
  /** ID of the assistant message this batch was emitted by. */
  messageId: string;
  toolName: string;
  items: PendingToolBatchItem[];
  status: 'awaiting_confirm' | 'running' | 'done';
}

export interface PendingToolBatchItem {
  callId: string;
  args: Record<string, unknown>;
  /** User selection state in the confirmation card. */
  selected: boolean;
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: unknown;
  error?: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: ChatContentBlock[];
  toolCalls?: PendingToolCall[];
  status: ChatMessageStatus;
  finishReason?: ChatFinishReason;
  inputTokens?: number;
  outputTokens?: number;
  modelVariant?: ChatModelVariant;
  errorCode?: string;
  errorMessage?: string;
  attachmentIds?: string[];
  createdAt: number;
}

export interface ChatSession {
  id: string;
  scope: ChatScope;
  title?: string;
  contextSnapshot?: unknown;
  messages: ChatMessage[];
  lastMessageAt?: number;
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  createdAt: number;
  updatedAt: number;
}

/** A persisted record of one tool execution, for analytics + status replay. */
export interface ToolExecutionRecord {
  id: string;
  messageId: string;
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  status: ToolCallStatus;
  result?: unknown;
  errorMessage?: string;
  durationMs?: number;
  createdAt: number;
  completedAt?: number;
}

/** Tool definition for the function-calling catalog. `parameters` is JSON Schema. */
export interface AiToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
