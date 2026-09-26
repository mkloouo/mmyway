const IS_DEV = process.env.APP_VARIANT === 'development' || process.env.APP_VARIANT === 'preview';
const BASE_BUNDLE_ID = 'com.mkloouo.mmyway';
const BASE_NAME = 'mmyway';

module.exports = {
  expo: {
    name: IS_DEV ? `${BASE_NAME} (Dev)` : BASE_NAME,
    slug: 'mmyway',
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    scheme: 'mmyway',
    plugins: ['expo-router'],
    android: {
      package: IS_DEV ? `${BASE_BUNDLE_ID}.dev` : BASE_BUNDLE_ID,
      permissions: ['android.permission.CAMERA'],
    },
    extra: {
      appVariant: process.env.APP_VARIANT ?? 'production',
    },
  },
};
