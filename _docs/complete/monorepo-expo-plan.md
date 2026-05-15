# Monorepo Migration: bun workspaces + Expo Mobile App

> Status: Complete

## Context

The existing Next.js 16 PWA (nihongo-vocabook) needs a React Native (Expo) mobile app for App Store / Play Store distribution. The PWA is temporary — the native app will be the primary product. The mobile app starts as a WebView wrapper loading the deployed web URL, with native features (push notifications, camera, offline storage) added incrementally.

### Key Decisions

| Decision | Rationale |
|----------|-----------|
| **Zero import rewrites** | Moving web app to `apps/web/` preserves `@/*` → `./src/*` (tsconfig-relative) |
| **No shared packages yet** | YAGNI — mobile is a WebView wrapper, no shared React code. Extract when building native screens |
| **Expo SDK 55** | Latest stable. Uses RN 0.83 + React 19.2.0 — matches web's React 19.2.3, zero conflict |
| **Mobile = auth only** | No guest mode on mobile. Mandatory sign-up → Supabase is sole data source. Eliminates iOS WKWebView offline/storage issues entirely |
| **bun workspaces** | Already using bun. No Turborepo needed for 2 apps |

---

## Target Structure

```
nihongo-vocabook/                  # repo root
├── package.json                   # workspace root
├── bun.lock                       # single lockfile (bun manages)
├── .gitignore                     # updated for monorepo + expo
├── .github/workflows/deploy.yml   # updated CI paths
├── .claude/                       # project tooling (stays)
├── CLAUDE.md                      # project instructions (paths updated)
├── _docs/                         # shared documentation (stays)
├── _note/                         # shared notes (stays)
├── supabase/                      # shared infra — migrations, seeds (stays)
│
├── apps/
│   ├── web/                       # existing Next.js app (moved)
│   │   ├── package.json           # name: "web"
│   │   ├── tsconfig.json          # @/* → ./src/* (UNCHANGED)
│   │   ├── next.config.ts
│   │   ├── eslint.config.mjs
│   │   ├── postcss.config.mjs
│   │   ├── serwist.config.js
│   │   ├── vitest.config.ts
│   │   ├── playwright.config.ts
│   │   ├── components.json
│   │   ├── Dockerfile
│   │   ├── src/                   # all source — internal paths unchanged
│   │   ├── public/
│   │   ├── e2e/
│   │   ├── dict/
│   │   ├── scripts/
│   │   └── jpn.traineddata
│   │
│   └── mobile/                    # new Expo app
│       ├── package.json           # name: "mobile"
│       ├── tsconfig.json          # extends expo/tsconfig.base
│       ├── app.json               # Expo config
│       ├── eas.json               # EAS Build profiles
│       ├── metro.config.js        # monorepo-aware Metro
│       ├── index.ts               # entry point
│       ├── src/
│       │   ├── app/               # Expo Router (file-based routing)
│       │   │   ├── _layout.tsx    # root layout
│       │   │   └── index.tsx      # home → WebView
│       │   ├── components/
│       │   │   └── webview/
│       │   │       └── app-webview.tsx
│       │   ├── lib/
│       │   │   └── bridge.ts      # WebView ↔ native bridge utils
│       │   └── types/
│       │       └── bridge.ts      # discriminated union message types
│       └── assets/                # app icon, splash screen
│
└── packages/                      # placeholder for future shared packages
    └── .gitkeep
```

---

## Implementation Phases

### Phase 0: Preparation

- [ ] Delete `pnpm-lock.yaml` (stale artifact, only `bun.lock` should exist)
- [ ] Verify all tests pass: `bun test` + `bun run test:e2e`
- [ ] Commit clean state → rollback point

### Phase 1: Create Workspace Root + Move Web App

**1a. Create directory skeleton:**

```bash
mkdir -p apps/web apps/mobile packages
touch packages/.gitkeep
```

**1b. Create root `package.json`** (replaces current):

```jsonc
{
  "name": "nihongo-vocabook",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "bun --filter web dev",
    "build": "bun --filter web build",
    "test": "bun --filter web test",
    "lint": "bun --filter web lint",
    "dev:mobile": "bun --filter mobile start",
    "seed:jlpt": "tsx supabase/seed-jlpt.ts",
    "seed:dictionary": "npx tsx supabase/seed-dictionary.ts",
    "seed:jlpt-ko": "npx tsx supabase/seed-jlpt-ko.ts"
  }
}
```

> Seed scripts stay at root because `supabase/` is shared infra.

**1c. Create `apps/web/package.json`** from current root package.json:

```jsonc
{
  "name": "web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build && serwist build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
  "dependencies": { /* ... same as current ... */ },
  "devDependencies": { /* ... same as current ... */ },
  "trustedDependencies": ["sharp", "unrs-resolver"]
}
```

> Remove `seed:*` scripts (moved to root). Remove `ignoreScripts` (not needed).

**1d. Move files via `git mv`** (preserves git history):

```bash
# Source code + assets
git mv src apps/web/src
git mv public apps/web/public
git mv e2e apps/web/e2e
git mv dict apps/web/dict
git mv scripts apps/web/scripts
git mv jpn.traineddata apps/web/jpn.traineddata

# Config files
git mv tsconfig.json apps/web/tsconfig.json
git mv next.config.ts apps/web/next.config.ts
git mv next-env.d.ts apps/web/next-env.d.ts
git mv eslint.config.mjs apps/web/eslint.config.mjs
git mv postcss.config.mjs apps/web/postcss.config.mjs
git mv serwist.config.js apps/web/serwist.config.js
git mv vitest.config.ts apps/web/vitest.config.ts
git mv playwright.config.ts apps/web/playwright.config.ts
git mv components.json apps/web/components.json
git mv Dockerfile apps/web/Dockerfile
git mv .mcp.json apps/web/.mcp.json

# Non-tracked files (regular mv)
mv .env.local apps/web/.env.local 2>/dev/null || true
mv .env.local.example apps/web/.env.local.example 2>/dev/null || true
```

**Files that stay at root:**

| File/Dir | Reason |
|----------|--------|
| `package.json` | Now workspace root |
| `bun.lock` | Workspace-level lockfile |
| `.github/` | Repo-level CI |
| `.claude/` | Claude Code tooling |
| `CLAUDE.md` | Project instructions |
| `_docs/`, `_note/` | Shared documentation |
| `supabase/` | Shared infra (migrations, seeds, data) |
| `.gitignore` | Repo-level |
| `README.md`, `LICENSE`, `HANDOFF.md` | Repo-level |

**1e. Why no config changes are needed** (verified):

| Config | Path reference | Still works? |
|--------|---------------|:------------:|
| `tsconfig.json` | `@/*` → `./src/*` | Yes — relative to tsconfig location |
| `components.json` | `@/components`, `@/lib/utils`, etc. | Yes — resolves via tsconfig |
| `vitest.config.ts` | `resolve(__dirname, 'src')` | Yes — `__dirname` = `apps/web/` |
| `serwist.config.js` | `swSrc: 'src/app/sw.ts'` | Yes — relative to config |
| `playwright.config.ts` | `testDir: './e2e'` | Yes — relative to config |
| `eslint.config.mjs` | `.next/**`, `out/**` globs | Yes — relative patterns |

**Verification:**
- `cd apps/web && bun run dev` — dev server starts
- `cd apps/web && bun run build` — production build succeeds
- `cd apps/web && bun test` — unit tests pass
- `cd apps/web && npx tsc --noEmit` — no TypeScript errors
- From root: `bun --filter web dev` — works

### Phase 2: Fix Breaking Script Paths

Scripts in `apps/web/scripts/` that reference `supabase/` or `_docs/` (which stay at root) will break:

| Script | Breaking reference | Fix |
|--------|-------------------|-----|
| `run-migrations.ts` | `join(__dirname, '..', 'supabase', 'migrations')` | `join(__dirname, '..', '..', '..', 'supabase', 'migrations')` |
| `test-ocr-accuracy.ts` | `resolve(__dirname, '../_docs/ocr/test-img')` | `resolve(__dirname, '../../../_docs/ocr/test-img')` |
| `test-llm-accuracy.ts` | `resolve(process.cwd(), '_docs/ocr/test-img')` | `resolve(process.cwd(), '../../_docs/ocr/test-img')` or use `__dirname` based |

> Scripts referencing `join(__dirname, '..', '.env.local')` are **SAFE** — `.env.local` moves with web app.

### Phase 3: Update `.gitignore`

Current rooted patterns (`/.next/`, `/coverage`, `public/sw.js`) won't match inside `apps/web/`. Change to unrooted patterns:

```gitignore
# dependencies
node_modules/
.pnp
.pnp.*

# next.js
.next/
out/

# expo
.expo/
ios/
android/
*.jks
*.keystore

# production
build/

# testing
coverage/
playwright-report/
test-results/

# serwist (generated service worker)
**/public/sw.js
**/public/sw.js.map
**/public/serwist-worker-*

# misc
.DS_Store
*.pem
Icon?

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# env files
.env*

# typescript
*.tsbuildinfo
next-env.d.ts

# other
.vercel
.playwright-mcp
```

### Phase 4: Update CI/CD

Changes to `.github/workflows/deploy.yml`:

```yaml
# build job
- name: Build
  env:
    NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
  run: cd apps/web && bun run build              # was: bun run build

- name: Clean macOS metadata
  run: find apps/web/public -name 'Icon?' -delete 2>/dev/null || true

- name: Package build
  run: tar -cf build.tar -C apps/web .next/standalone .next/static public
  # was: tar -cf build.tar .next/standalone .next/static public

# deploy job
- name: Checkout
  uses: actions/checkout@v4
  with:
    sparse-checkout: |
      apps/web/Dockerfile                         # was: Dockerfile

- name: Build Docker image
  run: DOCKER_BUILDKIT=1 docker build -t nihongo-vocabook -f apps/web/Dockerfile .
  # was: docker build -t nihongo-vocabook .
```

> Dockerfile itself doesn't change — it copies from extracted tar (flat structure).
> Cache key `gh-bun-${{ hashFiles('bun.lock') }}` still works (bun.lock at root).
> `bun install --frozen-lockfile` at root installs all workspaces.

**Verification:** Push to a test branch, confirm CI passes.

### Phase 5: Update Claude Code Config

All path references in `.claude/rules/codebase-map.md` need `apps/web/` prefix:

- `src/app/layout.tsx` → `apps/web/src/app/layout.tsx`
- `src/lib/styles.ts` → `apps/web/src/lib/styles.ts`
- ... (all entries in every table)

Also update:
- `CLAUDE.md` — path references in file reading strategy section
- `.claude/rules/project.md` — commands section if any paths
- `.claude/skills/*.md` — path references in code examples (documentation only, low priority)

Add new entries to `codebase-map.md` for mobile app:

```markdown
## Mobile App (Expo)

| Purpose | Path |
|---------|------|
| App entry | `apps/mobile/index.ts` |
| Root layout | `apps/mobile/src/app/_layout.tsx` |
| WebView home | `apps/mobile/src/app/index.tsx` |
| WebView component | `apps/mobile/src/components/webview/app-webview.tsx` |
| Bridge utils | `apps/mobile/src/lib/bridge.ts` |
| Bridge types | `apps/mobile/src/types/bridge.ts` |
| Expo config | `apps/mobile/app.json` |
| EAS config | `apps/mobile/eas.json` |
| Metro config | `apps/mobile/metro.config.js` |
```

### Phase 6: Scaffold Expo App (`apps/mobile/`)

**Stack:** Expo SDK 55 + React Native 0.83 + React 19.2 + Expo Router + react-native-webview

> React 19.2.0 (mobile) ≈ React 19.2.3 (web) — zero version conflict, no `nohoist` needed.

#### 6a. `apps/mobile/package.json`

```jsonc
{
  "name": "mobile",
  "version": "1.0.0",
  "private": true,
  "main": "index.ts",
  "scripts": {
    "start": "expo start",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "prebuild": "expo prebuild",
    "build:dev": "eas build --profile development",
    "build:preview": "eas build --profile preview",
    "build:prod": "eas build --profile production"
  },
  "dependencies": {
    "expo": "~55.0.0",
    "expo-router": "~5.0.0",
    "expo-status-bar": "~2.2.0",
    "expo-notifications": "~0.30.0",
    "expo-camera": "~16.1.0",
    "expo-haptics": "~14.0.0",
    "expo-secure-store": "~14.0.0",
    "react": "19.2.0",
    "react-native": "~0.83.0",
    "react-native-webview": "^13.12.0",
    "react-native-safe-area-context": "~5.1.0",
    "react-native-screens": "~4.5.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.0",
    "typescript": "^5.9.0"
  }
}
```

> Exact sub-dependency versions to be pinned after `npx create-expo-app@latest` or checking Expo SDK 55 compatibility table.

#### 6b. `apps/mobile/app.json`

```jsonc
{
  "expo": {
    "name": "NiVoca",
    "slug": "nivoca",
    "version": "1.0.0",
    "sdkVersion": "55.0.0",
    "orientation": "portrait",
    "newArchEnabled": true,
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "automatic",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#3eb8d4"
    },
    "ios": {
      "supportsTablet": false,
      "bundleIdentifier": "win.jun-devlog.nivoca",
      "infoPlist": {
        "NSCameraUsageDescription": "Used to scan Japanese text from images",
        "NSPhotoLibraryUsageDescription": "Used to select images with Japanese text"
      }
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#3eb8d4"
      },
      "package": "win.jundevlog.nivoca",
      "permissions": ["CAMERA", "VIBRATE", "RECEIVE_BOOT_COMPLETED"]
    },
    "plugins": [
      "expo-router",
      ["expo-notifications", { "icon": "./assets/notification-icon.png", "color": "#3eb8d4" }],
      ["expo-camera", { "cameraPermission": "Allow NiVoca to access your camera to scan Japanese text." }]
    ],
    "scheme": "nivoca",
    "extra": {
      "eas": { "projectId": "YOUR_EAS_PROJECT_ID" }
    }
  }
}
```

#### 6c. `apps/mobile/eas.json`

```jsonc
{
  "cli": { "version": ">= 14.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": { "EXPO_PUBLIC_WEB_URL": "http://localhost:3000" }
    },
    "preview": {
      "distribution": "internal",
      "env": { "EXPO_PUBLIC_WEB_URL": "https://nivoca.jun-devlog.win" }
    },
    "production": {
      "env": { "EXPO_PUBLIC_WEB_URL": "https://nivoca.jun-devlog.win" }
    }
  },
  "submit": { "production": {} }
}
```

#### 6d. `apps/mobile/metro.config.js` (monorepo-aware)

```js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

module.exports = config;
```

> Expo SDK 55 auto-configures most monorepo settings via `expo/metro-config`, but explicit `watchFolders` and `nodeModulesPaths` ensure correct resolution.

#### 6e. `apps/mobile/tsconfig.json`

```jsonc
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": {
      "@mobile/*": ["./src/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts"]
}
```

> Uses `@mobile/*` to avoid collision with web's `@/*` alias.

#### 6f. Core App Files

**`apps/mobile/index.ts`:**
```ts
import 'expo-router/entry';
```

**`apps/mobile/src/app/_layout.tsx`:**
```tsx
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaProvider>
  );
}
```

**`apps/mobile/src/app/index.tsx`:**
```tsx
import { AppWebView } from '../components/webview/app-webview';

export default function HomeScreen() {
  // WebView loads the web app which handles its own auth flow.
  // The web URL should point to the login page for unauthenticated users.
  // Mobile app enforces auth-only: no guest mode, no IndexedDB fallback.
  return <AppWebView />;
}
```

#### 6g. JS Bridge (WebView ↔ Native)

**`apps/mobile/src/types/bridge.ts`:**
```ts
// Web → Native messages
export type WebToNativeMessage =
  | { type: 'READY'; bridgeVersion: number }
  | { type: 'REQUEST_PUSH_TOKEN' }
  | { type: 'AUTH_TOKEN'; refreshToken: string }  // persist to SecureStore
  | { type: 'REQUEST_CAMERA'; options?: { mode: 'photo' | 'scan' } }
  | { type: 'HAPTIC_FEEDBACK'; style: 'light' | 'medium' | 'heavy' }
  | { type: 'SET_BADGE_COUNT'; count: number }
  | { type: 'OPEN_EXTERNAL_URL'; url: string }
  | { type: 'SHARE'; text: string; url?: string };

// Native → Web messages
export type NativeToWebMessage =
  | { type: 'PUSH_TOKEN'; token: string }
  | { type: 'PUSH_TOKEN_ERROR'; error: string }
  | { type: 'RESTORE_AUTH'; refreshToken: string }  // inject saved token on app start
  | { type: 'CAMERA_RESULT'; imageBase64: string }
  | { type: 'CAMERA_CANCELLED' }
  | { type: 'APP_INFO'; version: string; platform: 'ios' | 'android'; bridgeVersion: number }
  | { type: 'DEEP_LINK'; path: string }
  | { type: 'APP_STATE_CHANGE'; state: 'active' | 'background' | 'inactive' };
```

**`apps/mobile/src/components/webview/app-webview.tsx`:**
```tsx
import { useRef, useCallback, useEffect } from 'react';
import { Platform, BackHandler } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import type { WebToNativeMessage, NativeToWebMessage } from '../../types/bridge';

const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://nivoca.jun-devlog.win';
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
        return true;  // handled
      }
      return false;  // let system handle (exit app)
    });
    return () => handler.remove();
  }, []);

  const sendToWeb = useCallback((message: NativeToWebMessage) => {
    const js = `window.dispatchEvent(new CustomEvent('nativeMessage', { detail: ${JSON.stringify(message)} })); true;`;
    webViewRef.current?.injectJavaScript(js);
  }, []);

  const handleMessage = useCallback(async (event: WebViewMessageEvent) => {
    const message: WebToNativeMessage = JSON.parse(event.nativeEvent.data);

    switch (message.type) {
      case 'READY': {
        // Send app info
        sendToWeb({
          type: 'APP_INFO', version: '1.0.0',
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
        // Web app sends refresh token after login → persist natively
        await SecureStore.setItemAsync(AUTH_KEY, message.refreshToken);
        break;
      case 'REQUEST_PUSH_TOKEN': {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status === 'granted') {
          const token = await Notifications.getExpoPushTokenAsync();
          sendToWeb({ type: 'PUSH_TOKEN', token: token.data });
        } else {
          sendToWeb({ type: 'PUSH_TOKEN_ERROR', error: 'Permission denied' });
        }
        break;
      }
      case 'HAPTIC_FEEDBACK': {
        const style = message.style === 'heavy' ? Haptics.ImpactFeedbackStyle.Heavy
          : message.style === 'medium' ? Haptics.ImpactFeedbackStyle.Medium
          : Haptics.ImpactFeedbackStyle.Light;
        Haptics.impactAsync(style);
        break;
      }
      // Future: CAMERA, SHARE, etc.
    }
  }, [sendToWeb]);

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
```

### Phase 7: Web-side Bridge Integration (initial release에 포함)

Add `apps/web/src/lib/native-bridge.ts` to let the web app detect and communicate with the native layer:

```ts
export function isNativeApp(): boolean {
  return typeof window !== 'undefined' && !!window.NiVocaBridge?.isNative;
}
export function sendToNative(message: WebToNativeMessage): void {
  window.NiVocaBridge?.postMessage(message);
}
export function onNativeMessage(handler: (msg: NativeToWebMessage) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent).detail);
  window.addEventListener('nativeMessage', listener);
  return () => window.removeEventListener('nativeMessage', listener);
}
```

Use cases:
- **Skip SW registration** when `isNativeApp()` — PWA is web-only, no service worker in WebView
- Hide PWA install prompt when `isNativeApp()`
- Request native push token instead of browser notification
- Trigger haptic feedback on quiz card swipes
- Send auth refresh token to native SecureStore after login

**PWA disable in WebView** — add to SW registration logic:
```ts
// Skip service worker in native WebView
if (window.NiVocaBridge?.isNative) return;
navigator.serviceWorker.register('/sw.js');
```

---

## Verification Checklist

| Phase | Check |
|-------|-------|
| 0 | `bun test` + E2E green, clean git state |
| 1 | `bun install` at root succeeds, `cd apps/web && bun run dev` works, `bun run build` succeeds, `bun test` passes, `npx tsc --noEmit` clean |
| 2 | Scripts referencing `supabase/` and `_docs/` run correctly |
| 3 | `git status` shows no untracked files that should be ignored |
| 4 | CI pipeline green on test branch |
| 5 | Claude Code rules reference correct paths |
| 6 | `cd apps/mobile && bun install && bun start` launches Expo; WebView loads deployed URL |

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| ~~Apple Guideline 4.2 rejection~~ | ~~High~~ | ~~Resolved~~ — initial release includes push + haptic + splash + auth-only. Not a "lazy wrapper" |
| Auth session lost (WKWebView purge) | Medium | SecureStore persists refresh token natively; RESTORE_AUTH bridge message on app start |
| EAS Build ignores bun (#2658) | Medium | Add `"packageManager": "bun@1.x"` to root; override install in `eas.json` |
| CI tar path breaking | Medium | Test on a branch before merging to main |
| `.next/standalone` path shift | Low | Verified: Next.js generates relative to project root, unaffected by parent |
| `shadcn` CLI path resolution | Low | Verified: `components.json` aliases resolve via tsconfig, no change needed |
| ~~iOS WKWebView offline storage~~ | ~~High~~ | ~~Eliminated~~ — mobile requires auth, Supabase is sole data source |

---

## Out of Scope (future phases)

| Phase | Feature |
|-------|---------|
| Native OCR | `expo-camera` + cloud Vision API (replace web Tesseract) |
| Push notification backend | Supabase Edge Function → Expo Push API |
| Shared packages | Extract `packages/shared-types` when building native UI screens |
| PWA retirement | Remove serwist, redirect mobile web → app store links |
| ~~Native offline storage~~ | ~~Not needed~~ — mobile requires auth, no guest mode. Supabase handles all data |
