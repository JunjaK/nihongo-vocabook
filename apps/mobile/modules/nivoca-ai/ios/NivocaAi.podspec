Pod::Spec.new do |s|
  s.name           = 'NivocaAi'
  s.version        = '1.0.0'
  s.summary        = 'On-device Gemma 4 E2B inference via LiteRT-LM (iOS only).'
  s.description    = 'Wraps the vendored LiteRTLM.xcframework (Google LiteRT-LM C engine, prebuilt by hung-yueh/react-native-litert-lm v0.3.6 release) and exposes a multimodal infer() call to JS via Expo Modules.'
  s.author         = 'NiVoca'
  s.homepage       = 'https://nivoca.jun-devlog.win'
  s.platforms      = {
    :ios => '16.0'
  }
  s.source         = { git: '' }
  # Static framework is required so the Expo Modules autolinker can resolve
  # the vendored XCFramework symbols at link time without duplicate-symbol
  # warnings with React/Hermes.
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Bundled prebuilt LiteRT-LM engine — `Frameworks/LiteRTLM.xcframework`.
  # Sourced from https://github.com/hung-yueh/react-native-litert-lm/releases/tag/v0.3.6
  # then vendored verbatim (no API surface from that package is used in the
  # Swift code below — we link directly against the C engine).
  s.vendored_frameworks = 'Frameworks/LiteRTLM.xcframework'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    # The LiteRT-LM C API uses C++20 features in some companion headers
    # (e.g. `litert_lm_engine.h` brings in `<string_view>` from libc++).
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
    'CLANG_CXX_LIBRARY' => 'libc++',
    # Force `-ObjC` so the linker keeps all categories from the vendored
    # framework even when they aren't referenced directly from Swift.
    'OTHER_LDFLAGS' => '$(inherited) -ObjC',
    # CocoaPods only wires the `[CP] Copy XCFrameworks` phase into the
    # *consumer* (app) target, not into this pod itself — so the runtime
    # path `${PODS_XCFRAMEWORKS_BUILD_DIR}/NivocaAi/LiteRTLM.framework` does
    # not exist when Swift compiles `NivocaAiModule.swift`. Point the Swift
    # framework search at the slice we vendored on disk, branched by SDK so
    # the simulator (when we eventually build for it) picks its own slice.
    'FRAMEWORK_SEARCH_PATHS[sdk=iphoneos*]'        => '$(inherited) "$(PODS_TARGET_SRCROOT)/Frameworks/LiteRTLM.xcframework/ios-arm64"',
    'FRAMEWORK_SEARCH_PATHS[sdk=iphonesimulator*]' => '$(inherited) "$(PODS_TARGET_SRCROOT)/Frameworks/LiteRTLM.xcframework/ios-arm64-simulator"',
  }
  # Propagate the same SDK-branched framework search path to the app
  # aggregate target. Swift code in this pod auto-links `LiteRTLM` (emitted
  # as `LC_LINKER_OPTION -framework LiteRTLM` in the compiled `.o`), but the
  # final link happens at the app target — without this, that step fails
  # with "Could not find or use auto-linked framework 'LiteRTLM'" and a
  # cascade of `_litert_lm_*` undefined-symbol errors. We use a literal
  # `${SRCROOT}/../modules/...` path because `${PODS_TARGET_SRCROOT}` only
  # resolves inside the pod's own xcconfig.
  s.user_target_xcconfig = {
    'FRAMEWORK_SEARCH_PATHS[sdk=iphoneos*]'        => '$(inherited) "${SRCROOT}/../modules/nivoca-ai/ios/Frameworks/LiteRTLM.xcframework/ios-arm64"',
    'FRAMEWORK_SEARCH_PATHS[sdk=iphonesimulator*]' => '$(inherited) "${SRCROOT}/../modules/nivoca-ai/ios/Frameworks/LiteRTLM.xcframework/ios-arm64-simulator"',
  }

  # Preserve the original xcframework on disk so CocoaPods doesn't trim it
  # away during `pod install` deduplication.
  s.preserve_paths = 'Frameworks/LiteRTLM.xcframework/**/*'

  # Explicitly enumerate our Swift / Obj-C sources so the vendored
  # `Frameworks/LiteRTLM.xcframework` headers aren't double-counted as pod
  # sources (which produced "Multiple commands produce ...Headers/litert_lm_engine.h"
  # errors during link).
  s.source_files = "*.{h,m,mm,swift,hpp,cpp}"
  s.exclude_files = "Frameworks/**/*"
end
