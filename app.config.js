const IS_DEV = process.env.APP_VARIANT === 'development' || process.env.APP_VARIANT === 'preview';
// Set by eas.json's production-apk profile: per-ABI APKs + a universal one.
const ABI_SPLITS = process.env.ANDROID_ABI_SPLITS === '1';
const BASE_BUNDLE_ID = 'com.mkloouo.mmyway';
const BASE_NAME = 'mmyway';

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
      'expo-localization',
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
    android: {
      package: IS_DEV ? `${BASE_BUNDLE_ID}.dev` : BASE_BUNDLE_ID,
      permissions: ['android.permission.CAMERA'],
      // Off on purpose: the database holds every cached transaction and account balance, and
      // Android backups copy it into Google Drive. A new phone signs in and re-syncs from Firefly
      // III instead (drafts and aliases on the old phone are not carried over).
      allowBackup: false,
    },
    extra: {
      appVariant: process.env.APP_VARIANT ?? 'production',
      eas: {
        projectId: '88fb2848-3ae9-41a3-9952-b23a72698e6c',
      },
    },
  },
};
