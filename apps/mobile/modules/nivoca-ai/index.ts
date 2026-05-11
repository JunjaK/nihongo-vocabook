// Reexports the native module. On web it resolves to NivocaAiModule.web.ts
// and on native platforms to NivocaAiModule.ts. View component was removed —
// this module is pure JSI (no UI surface).
export { default } from './src/NivocaAiModule';
export * from './src/NivocaAi.types';
