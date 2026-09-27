const { withAppBuildGradle } = require('expo/config-plugins');

// Gradle ABI splits: one APK per ABI in gradle.properties'
// reactNativeArchitectures (the same set the single APK used to bundle), plus
// a universal APK carrying all of them. Only applied to the production-apk
// profile (see app.config.js) — dev builds and the AAB stay single-artifact.
const SPLITS_BLOCK = `
    splits {
        abi {
            enable true
            reset()
            include(*(findProperty("reactNativeArchitectures") ?: "armeabi-v7a,arm64-v8a,x86,x86_64").split(",").collect { it.trim() })
            universalApk true
        }
    }
`;

module.exports = function withAbiSplits(config) {
  return withAppBuildGradle(config, (config) => {
    const gradle = config.modResults.contents;
    if (gradle.includes('universalApk')) {
      return config;
    }
    if (!/^android\s*\{/m.test(gradle)) {
      throw new Error('withAbiSplits: no top-level `android {` block in app/build.gradle');
    }
    config.modResults.contents = gradle.replace(/^android\s*\{/m, (match) => match + SPLITS_BLOCK);
    return config;
  });
};
