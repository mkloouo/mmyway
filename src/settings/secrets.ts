import * as SecureStore from 'expo-secure-store';

const GEMINI_KEY = 'gemini_api_key';

export async function saveGeminiKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(GEMINI_KEY, key);
}

export async function readGeminiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(GEMINI_KEY);
}

export async function deleteGeminiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(GEMINI_KEY);
}
