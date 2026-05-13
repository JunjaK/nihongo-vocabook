import { useRef, useCallback, useEffect } from 'react';
import { Platform, BackHandler } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
import { getDeviceEligibility } from '../../lib/ai/device-eligibility';
import { runNativeInference } from '../../lib/ai/inference';
import { modelManager } from '../../lib/ai/model-manager';
import type {
  AiModelStatusSnapshot,
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
  // Wraps the multi-variant snapshot with device-eligibility info so the web
  // UI can disable downloads on unsupported hardware without a separate query.
  const buildStatusMessage = useCallback(
    (snapshot: AiModelStatusSnapshot): NativeToWebMessage => {
      const eligibility = getDeviceEligibility();
      return {
        type: 'AI_MODEL_STATUS_RESULT',
        snapshot,
        deviceSupported: eligibility.supported,
        modelName: eligibility.modelName ?? undefined,
      };
    },
    [],
  );

  // --- Subscribe to model-manager events and forward to web ---
  // Every snapshot change pushes an AI_MODEL_STATUS_RESULT. The web side
  // unpacks the per-variant view (installed[], active, downloading, error)
  // without needing additional event types.
  useEffect(() => {
    void modelManager.ensureBooted();
    return modelManager.subscribe((snapshot) => {
      sendToWeb(buildStatusMessage(snapshot));
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
          sendToWeb(buildStatusMessage(modelManager.getSnapshot()));
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

          // expo-image-picker requires an explicit permission request — it
          // does NOT auto-prompt from launch*Async. On a fresh install both
          // statuses start at "undetermined"; the request call triggers the
          // iOS native dialog (using `NSCamera/PhotoLibraryUsageDescription`
          // already declared in `app.json:ios.infoPlist`). A denial surfaces
          // back to the web with `CAMERA_CANCELLED` so the scan-store can
          // exit its loading state instead of hanging on the JS error.
          const permission =
            source === 'camera'
              ? await ImagePicker.requestCameraPermissionsAsync()
              : await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!permission.granted) {
            sendToWeb({ type: 'CAMERA_CANCELLED' });
            break;
          }

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
          sendToWeb(buildStatusMessage(modelManager.getSnapshot()));
          break;
        }

        case 'AI_MODEL_SET_ACTIVE':
          // Switch which installed variant is used for inference. No-op
          // when the variant isn't installed (UI shouldn't expose it).
          await modelManager.setActive(message.variantId);
          break;

        case 'AI_MODEL_DOWNLOAD_START': {
          // Single source of truth for device eligibility — refuse to start
          // even if the web client mistakenly enabled the button.
          const eligibility = getDeviceEligibility();
          if (!eligibility.supported) {
            // Synthesize an error tied to the requested variant so the UI
            // can clear it after the user acknowledges. The status
            // subscriber will repaint.
            sendToWeb(
              buildStatusMessage({
                ...modelManager.getSnapshot(),
                error: {
                  variantId: message.variantId,
                  message: 'unsupported_device',
                },
              }),
            );
            break;
          }
          // Fire-and-forget — progress flows via the snapshot subscriber.
          void modelManager.startDownload(message.variantId);
          break;
        }

        case 'AI_MODEL_DOWNLOAD_CANCEL':
          await modelManager.cancelDownload();
          break;

        case 'AI_MODEL_DELETE':
          await modelManager.deleteVariant(message.variantId);
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
      // Defaults to white, which flashes through the home-indicator strip
      // when the web body is shorter than the viewport or when the keyboard
      // dismisses. Pin to the web app's dark background to keep edges flush.
      style={{ flex: 1, backgroundColor: '#0a0a0a' }}
      // The web layout already pads for `env(safe-area-inset-bottom)`;
      // letting iOS double-pad bottom inset causes the visible white band.
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      // Disable iOS rubber-band overscroll — when the user pulls past the
      // top/bottom edge the inner UIScrollView would otherwise reveal its
      // white background. The web app provides its own pull-to-refresh
      // (or none), so the native bounce gesture is just visual noise.
      bounces={false}
    />
  );
}
