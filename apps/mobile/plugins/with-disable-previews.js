// Expo config plugin: disable SwiftUI Previews in Xcode build settings.
//
// Why: Xcode 26 enforces a hard linker restriction that __preview.dylib
// cannot link SwiftUICore unless the product is an Apple "allowed client".
// Even targets without any SwiftUI code generate a __preview.dylib stub,
// which then fails to link with:
//   "cannot link directly with 'SwiftUICore' because product being built
//    is not an allowed client of it"
//
// We don't use Xcode SwiftUI Previews (this is a React Native app), so we
// turn the feature off project-wide. Applied to:
//   1. Main app target build configurations (.pbxproj)
//   2. Pods project targets via Podfile post_install (covers expo modules)
const { withXcodeProject, withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

function setEnablePreviewsNo(xcodeProject) {
  const configList = xcodeProject.pbxXCConfigurationList();
  const configurations = xcodeProject.pbxXCBuildConfigurationSection();
  for (const key of Object.keys(configurations)) {
    const config = configurations[key];
    if (typeof config !== 'object' || !config.buildSettings) continue;
    config.buildSettings.ENABLE_PREVIEWS = 'NO';
  }
  return xcodeProject;
}

const withDisablePreviews = (config) => {
  config = withXcodeProject(config, (mod) => {
    mod.modResults = setEnablePreviewsNo(mod.modResults);
    return mod;
  });

  config = withDangerousMod(config, [
    'ios',
    async (mod) => {
      const podfilePath = path.join(mod.modRequest.platformProjectRoot, 'Podfile');
      let podfile = fs.readFileSync(podfilePath, 'utf8');
      const marker = '# DISABLE_PREVIEWS_INJECTED';
      if (podfile.includes(marker)) return mod;
      const snippet = `\n    ${marker}\n    installer.pods_project.targets.each do |t|\n      t.build_configurations.each do |c|\n        c.build_settings['ENABLE_PREVIEWS'] = 'NO'\n      end\n    end\n`;
      // Insert right before the closing `end` of the post_install block.
      podfile = podfile.replace(
        /(react_native_post_install\([\s\S]*?\)\s*\n)/,
        `$1${snippet}\n`,
      );
      fs.writeFileSync(podfilePath, podfile);
      return mod;
    },
  ]);

  return config;
};

module.exports = withDisablePreviews;
