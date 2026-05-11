import { useRef, useCallback, useEffect } from 'react';
import { Platform, BackHandler } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
import { getDeviceEligibility } from '../../lib/ai/device-eligibility';
import { runNativeInference } from '../../lib/ai/inference';
import { modelManager, type ModelStatus } from '../../lib/ai/model-manager';
import type {
  WebToNativeMessage,
  NativeToWebMessage,
} from '../../types/bridge';

const WEB_URL =
  process.env.EXPO_PUBLIC_WEB_URL ?? 'https://nivoca.jun-devlog.win';
const BRIDGE_VERSION = 1;
const AUTH_KEY = 'supabase_refresh_token';

export function AppWebView() {
  const webViewRef = useRef<WebView>(null);
  const canGoBackRef = useRef(false);

  // --- Android back button handling ---
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBackRef.current) {
        webViewRef.current?.goBack();
        return true; // handled — stay in app
      }
      return false; // let system handle (exit app)
    });

    return () => handler.remove();
  }, []);

  // --- Send message TO web ---
  const sendToWeb = useCallback((message: NativeToWebMessage) => {
    const js = `window.dispatchEvent(new CustomEvent('nativeMessage', { detail: ${JSON.stringify(message)} })); true;`;
    webViewRef.current?.injectJavaScript(js);
  }, []);

  // --- AI model status → bridge message ---
  // Builds the `AI_MODEL_STATUS_RESULT` payload from the live model-manager
  // state, enriched with device-eligibility so the web UI can disable the
  // download button on unsupported hardware without making a separate query.
  const buildStatusMessage = useCallback(
    (status: ModelStatus): NativeToWebMessage => {
      const eligibility = getDeviceEligibility();
      return {
        type: 'AI_MODEL_STATUS_RESULT',
        state: status.state,
        progress: status.progress,
        loadedBytes: status.loadedBytes,
        totalBytes: status.totalBytes,
        message: status.message,
        deviceSupported: eligibility.supported,
        modelName: eligibility.modelName ?? undefined,
      };
    },
    [],
  );

  // --- Subscribe to model-manager events and forward to web ---
  // Status transitions become AI_MODEL_STATUS_RESULT. Progress ticks during
  // downloading additionally fire AI_MODEL_DOWNLOAD_PROGRESS for UI components
  // that only care about progress. Terminal states emit COMPLETE / FAILED.
  useEffect(() => {
    void modelManager.ensureBooted();
    let prevState = modelManager.getStatus().state;
    return modelManager.subscribe((status) => {
      sendToWeb(buildStatusMessage(status));
      if (status.state === 'downloading' && status.progress !== undefined) {
        sendToWeb({
          type: 'AI_MODEL_DOWNLOAD_PROGRESS',
          progress: status.progress,
          loadedBytes: status.loadedBytes,
          totalBytes: status.totalBytes,
        });
      }
      if (prevState !== status.state) {
        if (status.state === 'installed') {
          sendToWeb({ type: 'AI_MODEL_DOWNLOAD_COMPLETE' });
        } else if (status.state === 'error') {
          sendToWeb({
            type: 'AI_MODEL_DOWNLOAD_FAILED',
            message: status.message ?? 'download_failed',
          });
        }
        prevState = status.state;
      }
    });
  }, [buildStatusMessage, sendToWeb]);

  // --- Handle message FROM web ---
  const handleMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      const message: WebToNativeMessage = JSON.parse(event.nativeEvent.data);

      switch (message.type) {
        case 'READY': {
          // Send app info to web
          sendToWeb({
            type: 'APP_INFO',
            version: '1.0.0',
            platform: Platform.OS as 'ios' | 'android',
            bridgeVersion: BRIDGE_VERSION,
          });

          // Restore auth session from SecureStore
          const savedToken = await SecureStore.getItemAsync(AUTH_KEY);
          if (savedToken) {
            sendToWeb({ type: 'RESTORE_AUTH', refreshToken: savedToken });
          }

          // Unsolicited AI model status — gives the web settings page an
          // initial value to render without having to wait for its own
          // AI_MODEL_STATUS round-trip.
          await modelManager.ensureBooted();
          sendToWeb(buildStatusMessage(modelManager.getStatus()));
          break;
        }

        case 'AUTH_TOKEN':
          // Web app sends refresh token after login — persist natively
          await SecureStore.setItemAsync(AUTH_KEY, message.refreshToken);
          break;

        case 'HAPTIC_FEEDBACK': {
          const style =
            message.style === 'heavy'
              ? Haptics.ImpactFeedbackStyle.Heavy
              : message.style === 'medium'
                ? Haptics.ImpactFeedbackStyle.Medium
                : Haptics.ImpactFeedbackStyle.Light;
          Haptics.impactAsync(style);
          break;
        }

        case 'REQUEST_CAMERA': {
          const source = message.options?.source ?? 'camera';
          const pickerOptions: ImagePicker.ImagePickerOptions = {
            mediaTypes: ['images'],
            quality: 0.85,
            base64: true,
            selectionLimit: source === 'gallery' ? 10 : 1,
          };

          const result =
            source === 'camera'
              ? await ImagePicker.launchCameraAsync(pickerOptions)
              : await ImagePicker.launchImageLibraryAsync(pickerOptions);

          if (result.canceled) {
            sendToWeb({ type: 'CAMERA_CANCELLED' });
          } else {
            const images = result.assets
              .filter((a) => a.base64)
              .map((a) => `data:image/jpeg;base64,${a.base64}`);
            sendToWeb({ type: 'CAMERA_RESULT', images });
          }
          break;
        }

        case 'SET_BADGE_COUNT':
          await Notifications.setBadgeCountAsync(message.count);
          break;

        case 'AI_MODEL_STATUS': {
          // Web asked for current status — reply on demand. The unsolicited
          // version still fires from READY, but the web side can re-ask any
          // time it remounts /settings/ocr.
          await modelManager.ensureBooted();
          sendToWeb(buildStatusMessage(modelManager.getStatus()));
          break;
        }

        case 'AI_MODEL_DOWNLOAD_START': {
          // Single source of truth for device eligibility — refuse to start
          // even if the web client mistakenly enabled the button.
          const eligibility = getDeviceEligibility();
          if (!eligibility.supported) {
            sendToWeb({
              type: 'AI_MODEL_DOWNLOAD_FAILED',
              message: 'unsupported_device',
            });
            break;
          }
          // Fire-and-forget — progress flows via the model-manager listener
          // wired in the effect above. Errors land on the same listener as
          // state === 'error' and we map them to AI_MODEL_DOWNLOAD_FAILED.
          void modelManager.startDownload();
          break;
        }

        case 'AI_MODEL_DOWNLOAD_CANCEL':
          await modelManager.cancelDownload();
          break;

        case 'AI_MODEL_DELETE':
          await modelManager.deleteModel();
          break;

        case 'AI_INFER_VISION': {
          // runNativeInference owns: base64 → cache file → LiteRT-LM call →
          // JSON parse → term filter → AiExtractedWord[]. We just route the
          // result back through the bridge and forward errors verbatim.
          try {
            const words = await runNativeInference(
              message.imageBase64,
              message.locale,
              message.requestId,
            );
            sendToWeb({
              type: 'AI_INFER_VISION_RESULT',
              requestId: message.requestId,
              words,
            });
          } catch (err) {
            sendToWeb({
              type: 'AI_INFER_VISION_FAILED',
              requestId: message.requestId,
              message: err instanceof Error ? err.message : 'infer_failed',
            });
          }
          break;
        }

        // Future: SHARE, OPEN_EXTERNAL_URL
      }
    },
    [sendToWeb],
  );

  // --- Inject NiVocaBridge global before web content loads ---
  const injectedJS = `
    window.NiVocaBridge = {
      postMessage: (msg) => window.ReactNativeWebView.postMessage(JSON.stringify(msg)),
      isNative: true,
      platform: '${Platform.OS}',
      bridgeVersion: ${BRIDGE_VERSION},
    };
    true;
  `;

  return (
    <WebView
      ref={webViewRef}
      source={{ uri: WEB_URL }}
      onMessage={handleMessage}
      onNavigationStateChange={(navState) => {
        canGoBackRef.current = navState.canGoBack;
      }}
      injectedJavaScriptBeforeContentLoaded={injectedJS}
      allowsBackForwardNavigationGestures
      sharedCookiesEnabled
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      javaScriptEnabled
      domStorageEnabled
    />
  );
}
