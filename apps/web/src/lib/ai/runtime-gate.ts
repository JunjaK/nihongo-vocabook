/**
 * Where the AI / on-device OCR feature is allowed to run.
 *
 * Policy (from the product side):
 *  - **native**: iOS WebView shell (Expo). Full access. Uses LiteRT-LM
 *    natively to drive Gemma 4 E2B/E4B.
 *  - **desktop**: any non-mobile browser. Full access. Uses transformers.js
 *    + WebGPU to drive Qwen3.5-2B in the page.
 *  - **mobile-browser**: Safari / Chrome on a phone or tablet. Blocked —
 *    WebKit per-tab memory cap kills the WebGPU path mid-load, and we
 *    can't push the user back into the native shell.
 *  - **pwa**: page installed to the home screen (display-mode=standalone)
 *    OR `navigator.standalone === true`. Blocked for the same reason as
 *    mobile-browser: still using the system WebView with its memory cap.
 *
 * "Allowed" is the simple disjunction: native OR desktop.
 */

import { isNativeApp } from '../native-bridge';

export type AiRuntimeMode =
  | 'native'
  | 'desktop'
  | 'mobile-browser'
  | 'pwa'
  | 'server';

/**
 * Detect the current runtime mode. Pure function, no side effects.
 * Defensive against SSR (`window === undefined`) and weird UAs.
 */
export function getAiRuntimeMode(): AiRuntimeMode {
  if (typeof window === 'undefined') return 'server';
  if (isNativeApp()) return 'native';

  // PWA check — two signals, either is enough:
  //   1. `display-mode: standalone` (Android, modern iOS PWA)
  //   2. `navigator.standalone === true` (legacy iOS Safari-pinned-to-home)
  const isStandalone =
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches) ||
    (typeof navigator !== 'undefined' &&
      // Non-standard iOS Safari API; cast through unknown to avoid `any`.
      (navigator as unknown as { standalone?: boolean }).standalone === true);
  if (isStandalone) return 'pwa';

  // Mobile UA — covers iOS Safari, Android Chrome, in-app browsers.
  // userAgentData is more reliable when available; fall back to UA string.
  const uaData = (navigator as unknown as { userAgentData?: { mobile?: boolean } })
    .userAgentData;
  const isMobileUA =
    uaData?.mobile === true ||
    /Android|iPhone|iPad|iPod|Mobile|BlackBerry|IEMobile|Opera Mini/i.test(
      typeof navigator !== 'undefined' ? navigator.userAgent : '',
    );
  if (isMobileUA) return 'mobile-browser';

  return 'desktop';
}

/** AI features are allowed in `native` + `desktop` only. */
export function isAiAllowed(): boolean {
  const mode = getAiRuntimeMode();
  return mode === 'native' || mode === 'desktop';
}

/**
 * i18n key for the user-facing "blocked" message. `null` when allowed.
 * Lets the settings page pick a localized string without re-deriving the
 * mode itself.
 */
export function getAiBlockedKey(): string | null {
  const mode = getAiRuntimeMode();
  if (mode === 'native' || mode === 'desktop') return null;
  if (mode === 'pwa') return 'pwaBlocked';
  if (mode === 'mobile-browser') return 'mobileBrowserBlocked';
  return null; // 'server' — SSR phase, no user-visible message
}
