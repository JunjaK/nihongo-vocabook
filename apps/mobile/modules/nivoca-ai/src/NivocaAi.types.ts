/**
 * Status of the on-device AI model lifecycle, mirrored on the web side via
 * the existing bridge. State strings deliberately match
 * `apps/web/src/lib/ai/types.ts:ModelStatus`.
 */
export type ModelStatusState = 'not_installed' | 'downloading' | 'installed' | 'error';

export interface ModelStatusPayload {
  state: ModelStatusState;
  progress?: number;
  loadedBytes?: number;
  totalBytes?: number;
  message?: string;
}

export type NivocaAiModuleEvents = {
  /**
   * Emitted on download progress + state transitions (throttled to ≤1 Hz on
   * the native side to keep React Native bridge traffic low).
   */
  onModelStatus: (payload: ModelStatusPayload) => void;
};

// ---------------------------------------------------------------------------
// Text inference (Phase 0 PoC + Phase 1)
// ---------------------------------------------------------------------------

/** A single multimodal content block inside a message. */
export type AiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; path: string }
  | { type: 'tool_result'; toolName: string; toolCallId: string; result: unknown };

/** One message in a chat history. */
export interface AiTextMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: AiContentBlock[];
}

/** Function-calling tool definition. `parameters` is a JSON Schema object. */
export interface AiToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Sampling / generation options. All fields optional — defaults applied natively. */
export interface AiTextInferOptions {
  maxOutputTokens?: number;
  temperature?: number;
}

/** Full request payload for the native `inferText` call. */
export interface AiTextInferRequest {
  messages: AiTextMessage[];
  tools?: AiToolDef[];
  options?: AiTextInferOptions;
}
