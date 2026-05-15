# Mobile App Setup (Clean Clone)

The Expo iOS app at `apps/mobile/` needs **two extra artifacts that are not
checked into Git** before you can run inference on a real device:

1. **`LiteRTLM.xcframework`** (~205 MB) — vendored under
   `apps/mobile/modules/nivoca-ai/ios/Frameworks/`. Gitignored because the
   two static-archive binaries are ~82 MB each and bloat clones.
2. **Gemma 4 E2B model file** (~2.5 GB) — fetched at runtime by the user
   inside the app, not part of the source tree.

Web (Next.js) developers can ignore this doc — neither artifact is needed
for `bun run dev`.

---

## 1. LiteRT-LM XCFramework (pre-build, required)

The framework is the unmodified XCFramework artifact from
[hung-yueh/react-native-litert-lm v0.3.6](https://github.com/hung-yueh/react-native-litert-lm/releases/tag/v0.3.6).
We do not depend on the `react-native-litert-lm` npm package — only the
binary. The Swift bridge in `apps/mobile/modules/nivoca-ai/ios/` calls
Google's C engine directly.

### Steps

Download `LiteRTLM.xcframework` from the v0.3.6 release page and unzip to:

```
apps/mobile/modules/nivoca-ai/ios/Frameworks/LiteRTLM.xcframework/
```

Expected layout after unzip:

```
Frameworks/
  LiteRTLM.xcframework/
    Info.plist
    ios-arm64/
      LiteRTLM.framework/
        LiteRTLM                      # static archive, ~82 MB
        Headers/litert_lm_engine.h
        Modules/module.modulemap      # may need manual creation, see below
        Info.plist
    ios-arm64-simulator/
      LiteRTLM.framework/
        ... (same shape)
```

If `Modules/module.modulemap` is missing in the upstream release, create
it under **both** slices with this content:

```
framework module LiteRTLM {
  header "litert_lm_engine.h"
  export *
}
```

Without the module map, Swift's `import LiteRTLM` in
`NivocaAiModule.swift` will fail with "no such module 'LiteRTLM'".

### Build

Once the framework is in place:

```bash
cd apps/mobile
bunx expo run:ios --device <UDID>
```

CocoaPods picks up the vendored framework via `NivocaAi.podspec`. The root
`Podfile`'s `post_install` hook adds the SDK-branched search paths to the
app aggregate target so the static archive's `_litert_lm_*` symbols
resolve at app link time.

### Supported devices

- **iPhone**: A15 or newer (iPhone 13 family and later, iPhone SE 3rd gen)
- **iPad**: M1 or newer (iPad Pro 11" 3rd gen / Pro 12.9" 5th gen and
  later, iPad Air 5+, iPad mini 6+)
- **Older devices**: download button is disabled at the device-eligibility
  gate (`apps/mobile/src/lib/ai/device-eligibility.ts`).

---

## 2. Gemma 4 E2B model (runtime download, user-driven)

The model file (`gemma-4-E2B-it.litertlm`, ~2.5 GB) is **not bundled** with
the app and **not pre-downloaded** during setup. Each user pulls it once
via the in-app settings flow.

### How to trigger

After installing the dev build:

1. Open the app on the supported device.
2. Navigate to **Settings → OCR (AI vision)**.
3. Tap **Download Gemma 4 E2B**.
4. Wait for the progress bar to reach 100% (Wi-Fi + charger recommended;
   transfer is ~25 min on average residential broadband).

The file lands at `<Documents>/ai-models/gemma-4-E2B-it.litertlm` and is
excluded from iCloud backup. Cancel / resume / delete are all wired
through `apps/mobile/src/lib/ai/model-manager.ts`. SecureStore tracks the
install state across cold starts so re-launching the app does not
re-download.

### Why not bundle?

- App Store / TestFlight per-build hard limit (~4 GB compressed, ~2 GB
  practical) would be tight.
- The model can be updated independently of the app binary by switching
  the HF URL in `model-manager.ts`.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `no such module 'LiteRTLM'` at Swift compile | Step 1 not done, or `Modules/module.modulemap` missing under one of the slices. |
| `ld: symbol(s) not found: _litert_lm_*` at app link | `Podfile` `post_install` hook didn't run — re-run `pod install` from `apps/mobile/ios`. |
| `model_missing` error after tapping **Scan** | User hasn't completed step 2 yet. Send them to Settings → OCR. |
| Download stalls at ~90% | iOS WebKit memory cap during web fallback path, not the native path. Confirm the user is on the dev build, not the web PWA. |
