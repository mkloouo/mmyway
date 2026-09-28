const IS_DEV = process.env.APP_VARIANT === 'development' || process.env.APP_VARIANT === 'preview';
// Set by eas.json's production-apk profile: per-ABI APKs + a universal one.
const ABI_SPLITS = process.env.ANDROID_ABI_SPLITS === '1';
const BASE_BUNDLE_ID = 'com.mkloouo.mmyway';
const BASE_NAME = 'Money done My Way';

module.exports = {
  expo: {
    name: IS_DEV ? `${BASE_NAME} (Dev)` : BASE_NAME,
    slug: 'mmyway',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    scheme: 'mmyway',
    plugins: [
      'expo-router',
      [
        'expo-share-intent',
        {
          iosActivationRules: { NSExtensionActivationSupportsImageWithMaxCount: 10 },
          androidIntentFilters: ['image/*'],
          disableAndroid: false,
          disableIOS: true,
        },
      ],
      '@react-native-community/datetimepicker',
      [
        // Assets and colours: scripts/generate-icons.py. Backgrounds are src/ui/theme.ts's bg.
        'expo-splash-screen',
        {
          image: './assets/splash/splash-light.png',
          imageWidth: 180,
          backgroundColor: '#F5F5F3',
          dark: { image: './assets/splash/splash-dark.png', backgroundColor: '#0F1013' },
        },
      ],
      [
        'expo-build-properties',
        {
          android: {
            enableMinifyInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
            useLegacyPackaging: true,
            // FF3 and the local receipt model are often reached over plain http:// (a LAN IP, a
            // tailnet name). Release builds block cleartext by default; only debug builds allowed it.
            usesCleartextTraffic: true,
          },
        },
      ],
      ...(ABI_SPLITS ? ['./plugins/withAbiSplits'] : []),
    ],
    ios: {
      bundleIdentifier: IS_DEV ? `${BASE_BUNDLE_ID}.dev` : BASE_BUNDLE_ID,
      icon: {
        light: './assets/icon.png',
        dark: './assets/ios/icon-dark.png',
        tinted: './assets/ios/icon-tinted.png',
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/android/adaptive-foreground.png',
        monochromeImage: './assets/android/adaptive-foreground.png',
        backgroundColor: '#3746BB',
      },
      package: IS_DEV ? `${BASE_BUNDLE_ID}.dev` : BASE_BUNDLE_ID,
      permissions: ['android.permission.CAMERA'],
    },
    extra: {
      appVariant: process.env.APP_VARIANT ?? 'production',
      eas: {
        projectId: '88fb2848-3ae9-41a3-9952-b23a72698e6c',
      },
    },
  },
};
