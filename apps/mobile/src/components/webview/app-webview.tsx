import { useRef, useCallback, useEffect } from 'react';
import { Platform, BackHandler } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
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
          break;
        }

        case 'AUTH_TOKEN':
          // Web app sends refresh token after login — persist natively
          await SecureStore.setItemAsync(AUTH_KEY, message.refreshToken);
          break;

        case 'REQUEST_PUSH_TOKEN': {
          const { status } = await Notifications.requestPermissionsAsync();
          if (status === 'granted') {
            const token = await Notifications.getExpoPushTokenAsync();
            sendToWeb({ type: 'PUSH_TOKEN', token: token.data });
          } else {
            sendToWeb({
              type: 'PUSH_TOKEN_ERROR',
              error: 'Permission denied',
            });
          }
          break;
        }

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

        case 'SCHEDULE_NOTIFICATION':
          // Cancel existing before scheduling new
          await Notifications.cancelScheduledNotificationAsync('daily-quiz-reminder').catch(() => {});
          await Notifications.scheduleNotificationAsync({
            identifier: 'daily-quiz-reminder',
            content: {
              title: 'NiVoca',
              body: 'Time to review your words! 📚',
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DAILY,
              hour: message.hour,
              minute: message.minute,
            },
          });
          break;

        case 'CANCEL_NOTIFICATION':
          await Notifications.cancelScheduledNotificationAsync('daily-quiz-reminder').catch(() => {});
          break;

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
