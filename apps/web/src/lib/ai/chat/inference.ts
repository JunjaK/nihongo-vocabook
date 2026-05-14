/**
 * Streaming inference adapter — bridges the web app to the native LiteRT-LM
 * engine via `AI_INFER` / `AI_INFER_TOKEN` / `AI_INFER_DONE` / `AI_INFER_ERROR`
 * messages.
 *
 * Exposes:
 *  - `streamInfer(request, signal)` — AsyncGenerator yielding token deltas,
 *    parsed tool calls, and final done/error events.
 *  - `cancelInfer(requestId)` — fire-and-forget cancellation.
 *
 * The stream parser runs inline so consumers receive parsed `tool_call`
 * events instead of raw `<tool_call>` tags.
 */

import {
  isNativeApp,
  onNativeMessage,
  sendToNative,
  type AiInferRequest,
  type NativeToWebMessage,
} from '@/lib/native-bridge';
import { ToolCallStreamParser, type ParsedChunk } from './parser';

export type InferEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'parse_error'; raw: string }
  | {
      type: 'done';
      fullText: string;
      finishReason: 'stop' | 'length' | 'tool_call' | 'error';
      inputTokens?: number;
      outputTokens?: number;
      modelVariant?: string;
    }
  | { type: 'error'; code: string; message: string };

interface PendingStream {
  push: (event: InferEvent) => void;
  close: () => void;
  parser: ToolCallStreamParser;
  fullText: string;
}

const active = new Map<string, PendingStream>();
let subscriptionInstalled = false;

function ensureSubscription(): void {
  if (subscriptionInstalled) return;
  if (typeof window === 'undefined') return;
  subscriptionInstalled = true;
  onNativeMessage((message) => {
    handleNativeMessage(message);
  });
}

function handleNativeMessage(message: NativeToWebMessage): void {
  if (message.type === 'AI_INFER_TOKEN') {
    const entry = active.get(message.requestId);
    if (!entry) return;
    entry.fullText += message.delta;
    const chunks = entry.parser.feed(message.delta);
    for (const c of chunks) emitParsed(entry, c);
    return;
  }
  if (message.type === 'AI_INFER_DONE') {
    const entry = active.get(message.requestId);
    if (!entry) return;
    // Flush parser
    for (const c of entry.parser.flush()) emitParsed(entry, c);
    entry.push({
      type: 'done',
      fullText: message.fullText || entry.fullText,
      finishReason: message.finishReason,
      inputTokens: message.inputTokens,
      outputTokens: message.outputTokens,
      modelVariant: message.modelVariant,
    });
    entry.close();
    active.delete(message.requestId);
    return;
  }
  if (message.type === 'AI_INFER_ERROR') {
    const entry = active.get(message.requestId);
    if (!entry) return;
    entry.push({ type: 'error', code: message.code, message: message.message });
    entry.close();
    active.delete(message.requestId);
  }
}

function emitParsed(entry: PendingStream, chunk: ParsedChunk): void {
  if (chunk.type === 'text') {
    entry.push({ type: 'text_delta', text: chunk.text });
  } else if (chunk.type === 'tool_call') {
    entry.push({ type: 'tool_call', name: chunk.name, args: chunk.args });
  } else if (chunk.type === 'parse_error') {
    entry.push({ type: 'parse_error', raw: chunk.raw });
  }
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `infer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

class EventQueue {
  private queue: InferEvent[] = [];
  private waiters: Array<(value: IteratorResult<InferEvent>) => void> = [];
  private closed = false;
  private error: Error | null = null;

  push(event: InferEvent): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }

  close(): void {
    this.closed = true;
    while (this.waiters.length > 0) {
      const w = this.waiters.shift()!;
      w({ value: undefined as unknown as InferEvent, done: true });
    }
  }

  failWith(err: Error): void {
    this.error = err;
    this.close();
  }

  async next(): Promise<IteratorResult<InferEvent>> {
    if (this.error) {
      const err = this.error;
      this.error = null;
      throw err;
    }
    if (this.queue.length > 0) {
      return { value: this.queue.shift()!, done: false };
    }
    if (this.closed) {
      return { value: undefined as unknown as InferEvent, done: true };
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

export function cancelInfer(requestId: string): void {
  if (!isNativeApp()) return;
  sendToNative({ type: 'AI_INFER_CANCEL', requestId });
}

/**
 * Stream events for a single inference request. Yields text deltas, tool_call
 * events, and a terminal done or error event.
 *
 * Cancellation via AbortSignal: rejects the generator immediately and sends
 * `AI_INFER_CANCEL` to the native side. The native response may still arrive
 * later but maps to a non-existent entry (drops silently).
 */
export async function* streamInfer(
  request: AiInferRequest,
  signal?: AbortSignal,
): AsyncGenerator<InferEvent, void, void> {
  ensureSubscription();
  if (!isNativeApp()) {
    yield { type: 'error', code: 'not_native', message: 'AI inference requires the iOS app' };
    return;
  }

  const requestId = newRequestId();
  const queue = new EventQueue();
  const parser = new ToolCallStreamParser();
  const entry: PendingStream = {
    push: (e) => queue.push(e),
    close: () => queue.close(),
    parser,
    fullText: '',
  };
  active.set(requestId, entry);

  const onAbort = () => {
    cancelInfer(requestId);
    queue.failWith(signal?.reason instanceof Error ? signal.reason : new Error('aborted'));
    active.delete(requestId);
  };

  if (signal) {
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  sendToNative({ type: 'AI_INFER', requestId, request });

  try {
    while (true) {
      const { value, done } = await queue.next();
      if (done) return;
      yield value;
      if (value.type === 'done' || value.type === 'error') return;
    }
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
    active.delete(requestId);
  }
}
