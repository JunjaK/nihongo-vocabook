/** Public API barrel for the chat module. */

export { useChatStore } from './store';
export { streamInfer, cancelInfer, type InferEvent } from './inference';
export { ToolCallStreamParser, type ParsedChunk } from './parser';
export {
  TOOLS,
  getTool,
  getToolDefsForBridge,
  type ToolDefinition,
  type ToolContext,
} from './tools';
export {
  buildSystemPrompt,
  baseSystemPrompt,
  estimateTokens,
  trimHistoryToBudget,
} from './prompts';
export {
  storeAttachment,
  getAttachment,
  getAttachmentPreviewUrl,
  deleteAttachment,
  pruneAttachments,
  type AttachmentRecord,
} from './attachments';
export {
  recordMetric,
  listMetrics,
  pruneMetrics,
  clearAllMetrics,
  type AiMetric,
} from './metrics';
