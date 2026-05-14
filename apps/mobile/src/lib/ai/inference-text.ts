/**
 * Phase 0 PoC wrapper for the native `inferText` AsyncFunction.
 *
 * Serializes an `AiTextInferRequest` to JSON, calls into Swift, and returns
 * the raw model text exactly as emitted (including any `<tool_call>...
 * </tool_call>` tags). Parsing tool calls / scoring is the responsibility of
 * `apps/mobile/scripts/poc-tool-calling.ts` so the PoC can stay observable.
 *
 * Phase 1 will replace this with a streaming variant on top of
 * `litert_lm_conversation_send_message_stream` (see C API inspection in
 * `_docs/ai-chat-poc-results.md`).
 */

import NivocaAi from '../../../modules/nivoca-ai';
import type { AiTextInferRequest } from '../../../modules/nivoca-ai/src/NivocaAi.types';

export async function runTextInference(
  request: AiTextInferRequest,
): Promise<string> {
  const requestJson = JSON.stringify(request);
  const t0 = Date.now();
  console.log(
    `[nivoca-ai] inferText start messages=${request.messages.length} tools=${request.tools?.length ?? 0} body.len=${requestJson.length}`,
  );
  try {
    const raw = await NivocaAi.inferText(requestJson);
    console.log(
      `[nivoca-ai] inferText returned in ${Date.now() - t0}ms raw.len=${raw.length}`,
    );
    if (raw.length > 0) {
      console.log(`[nivoca-ai] raw.head=${JSON.stringify(raw.slice(0, 600))}`);
      if (raw.length > 600) {
        console.log(`[nivoca-ai] raw.tail=${JSON.stringify(raw.slice(-200))}`);
      }
    }
    return raw;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[nivoca-ai] inferText failed in ${Date.now() - t0}ms: ${msg}`);
    throw err;
  }
}
