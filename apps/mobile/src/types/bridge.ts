/** Messages sent from Web (WebView) to Native (Expo) */
export type WebToNativeMessage =
  | { type: 'READY'; bridgeVersion: number }
  | { type: 'REQUEST_PUSH_TOKEN' }
  | { type: 'AUTH_TOKEN'; refreshToken: string }
  | { type: 'REQUEST_CAMERA'; options?: { source: 'camera' | 'gallery' } }
  | { type: 'HAPTIC_FEEDBACK'; style: 'light' | 'medium' | 'heavy' }
  | { type: 'SET_BADGE_COUNT'; count: number }
  | { type: 'OPEN_EXTERNAL_URL'; url: string }
  | { type: 'SHARE'; text: string; url?: string }
  | { type: 'SCHEDULE_NOTIFICATION'; hour: number; minute: number }
  | { type: 'CANCEL_NOTIFICATION' };

/** Messages sent from Native (Expo) to Web (WebView) */
export type NativeToWebMessage =
  | { type: 'PUSH_TOKEN'; token: string }
  | { type: 'PUSH_TOKEN_ERROR'; error: string }
  | { type: 'RESTORE_AUTH'; refreshToken: string }
  | { type: 'CAMERA_RESULT'; images: string[] }
  | { type: 'CAMERA_CANCELLED' }
  | {
      type: 'APP_INFO';
      version: string;
      platform: 'ios' | 'android';
      bridgeVersion: number;
    }
  | { type: 'DEEP_LINK'; path: string }
  | {
      type: 'APP_STATE_CHANGE';
      state: 'active' | 'background' | 'inactive';
    };
