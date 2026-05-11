import * as Device from 'expo-device';
import { Platform } from 'react-native';

/**
 * Device eligibility for the on-device AI (Gemma 4 E2B via LiteRT-LM).
 *
 * The model is ~1.5 GB on disk and consumes 1.5–2 GB of process memory during
 * weight upload + first inference. WebKit's per-tab memory cap on older iOS
 * devices forces the OS to reclaim the page mid-load — the user sees a white
 * refresh. To prevent that, we hard-gate the download UI to A15+ iPhones and
 * M-series / A15+ iPads. Older devices stay on the web (Qwen3.5) path.
 *
 * The whitelist is keyed on `Device.modelId` (e.g. `iPhone14,5`). Apple uses
 * `iPhone<major>,<minor>` and `iPad<major>,<minor>` identifiers. For future
 * devices (iPhone 18+, iPad17+) we apply a prefix-major fallback so a new
 * iPhone launching after we ship doesn't require a client update.
 *
 * Reference table for identifiers:
 *   https://gist.github.com/adamawolf/3048717
 */

/** Explicit iPhone identifiers — A15 Bionic and newer. */
const SUPPORTED_IPHONE_IDS = new Set<string>([
  // iPhone 13 family (A15)
  'iPhone14,4', // iPhone 13 mini
  'iPhone14,5', // iPhone 13
  'iPhone14,2', // iPhone 13 Pro
  'iPhone14,3', // iPhone 13 Pro Max
  // SE 3rd gen (A15)
  'iPhone14,6',
  // iPhone 14 family (A15 for non-Pro, A16 for Pro)
  'iPhone14,7', // iPhone 14
  'iPhone14,8', // iPhone 14 Plus
  'iPhone15,2', // iPhone 14 Pro
  'iPhone15,3', // iPhone 14 Pro Max
  // iPhone 15 family (A16 for non-Pro, A17 Pro for Pro)
  'iPhone15,4', // iPhone 15
  'iPhone15,5', // iPhone 15 Plus
  'iPhone16,1', // iPhone 15 Pro
  'iPhone16,2', // iPhone 15 Pro Max
  // iPhone 16 family (A18 / A18 Pro)
  'iPhone17,1', // iPhone 16 Pro
  'iPhone17,2', // iPhone 16 Pro Max
  'iPhone17,3', // iPhone 16
  'iPhone17,4', // iPhone 16 Plus
  'iPhone17,5', // iPhone 16e
]);

/**
 * Prefix-major fallback so future devices auto-pass when we haven't shipped
 * a client update. Anything with `iPhone<MAJOR>` ≥ this constant is allowed.
 * 18 covers iPhone 17 family and forward. Conservative — extends naturally.
 */
const IPHONE_FUTURE_MAJOR_MIN = 18;

/** Explicit iPad identifiers — M1 / A15 or newer. */
const SUPPORTED_IPAD_IDS = new Set<string>([
  // iPad Pro 11" 3rd gen (M1)
  'iPad13,4', 'iPad13,5', 'iPad13,6', 'iPad13,7',
  // iPad Pro 12.9" 5th gen (M1)
  'iPad13,8', 'iPad13,9', 'iPad13,10', 'iPad13,11',
  // iPad Air 5 (M1)
  'iPad13,16', 'iPad13,17',
  // iPad mini 6 (A15)
  'iPad14,1', 'iPad14,2',
  // iPad Pro 11" 4th gen (M2)
  'iPad14,3', 'iPad14,4',
  // iPad Pro 12.9" 6th gen (M2)
  'iPad14,5', 'iPad14,6',
  // iPad Air 6 (M2) — 11"/13"
  'iPad14,8', 'iPad14,9', 'iPad14,10', 'iPad14,11',
  // iPad mini 7 (A17 Pro)
  'iPad15,1', 'iPad15,2',
  // iPad Pro M4 11" / 13"
  'iPad16,1', 'iPad16,2', 'iPad16,3', 'iPad16,4',
  // iPad Air M3 (placeholder — adjust when shipping data confirmed)
  'iPad16,5', 'iPad16,6',
]);

/** Future-major fallback for iPads (M3/M4/M5 generations). */
const IPAD_FUTURE_MAJOR_MIN = 17;

export interface DeviceEligibility {
  supported: boolean;
  /** Marketing-style name from `expo-device` (e.g. "iPhone 14 Pro"). May be null on simulator. */
  modelName: string | null;
  /** Apple identifier — `iPhone14,5` etc. May be null when running in browser. */
  modelId: string | null;
  /** Reason code for telemetry / i18n key lookup if `supported === false`. */
  reason: 'supported' | 'unsupported_ios_device' | 'non_ios' | 'unknown';
}

function parseMajor(prefix: 'iPhone' | 'iPad', modelId: string): number | null {
  const match = modelId.match(new RegExp(`^${prefix}(\\d+),\\d+$`));
  return match ? parseInt(match[1], 10) : null;
}

export function getDeviceEligibility(): DeviceEligibility {
  if (Platform.OS !== 'ios') {
    return {
      supported: false,
      modelName: Device.modelName ?? null,
      modelId: Device.modelId ?? null,
      reason: 'non_ios',
    };
  }

  const modelId = Device.modelId ?? null;
  const modelName = Device.modelName ?? null;

  if (!modelId) {
    // Should only happen on web or when `expo-device` can't determine — be
    // conservative and refuse rather than risk an unsupported install.
    return { supported: false, modelName, modelId, reason: 'unknown' };
  }

  if (SUPPORTED_IPHONE_IDS.has(modelId) || SUPPORTED_IPAD_IDS.has(modelId)) {
    return { supported: true, modelName, modelId, reason: 'supported' };
  }

  const iphoneMajor = parseMajor('iPhone', modelId);
  if (iphoneMajor !== null && iphoneMajor >= IPHONE_FUTURE_MAJOR_MIN) {
    return { supported: true, modelName, modelId, reason: 'supported' };
  }

  const ipadMajor = parseMajor('iPad', modelId);
  if (ipadMajor !== null && ipadMajor >= IPAD_FUTURE_MAJOR_MIN) {
    return { supported: true, modelName, modelId, reason: 'supported' };
  }

  return { supported: false, modelName, modelId, reason: 'unsupported_ios_device' };
}
