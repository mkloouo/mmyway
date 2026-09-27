import { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, Alert, FlatList } from 'react-native';
import { signIn, signOut, readStoredCredentials } from '../../src/api/ff3/auth';
import { saveGeminiKey, readGeminiKey } from '../../src/settings/secrets';
import { useDb } from '../../src/providers/DbProvider';
import { referenceAccounts, referenceCurrencies } from '../../src/db/schema';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import {
  getLocalModelBaseUrl, setLocalModelBaseUrl,
  getLocalModelName, setLocalModelName,
  getDefaultSourceAccountId, setDefaultSourceAccountId,
  getDefaultCurrencyCode, setDefaultCurrencyCode,
} from '../../src/settings/appSettings';

export default function SettingsScreen() {
  const db = useDb();
  const [host, setHost] = useState('');
  const [token, setToken] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [localModelUrl, setLocalModelUrl] = useState('');
  const [localModelName, setLocalModelNameState] = useState('');
  const [defaultAccountId, setDefaultAccountId] = useState<string | null>(null);
  const [defaultCurrency, setDefaultCurrency] = useState<string | null>(null);

  const { data: accounts } = useLiveQuery(db.select().from(referenceAccounts));
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));

  useEffect(() => {
    (async () => {
      const stored = await readStoredCredentials();
      if (stored) setHost(stored.host);
      setHasGeminiKey((await readGeminiKey()) !== null);
      setLocalModelUrl((await getLocalModelBaseUrl(db)) ?? '');
      setLocalModelNameState((await getLocalModelName(db)) ?? '');
      setDefaultAccountId(await getDefaultSourceAccountId(db));
      setDefaultCurrency(await getDefaultCurrencyCode(db));
    })();
  }, [db]);

  return (
    <View style={{ flex: 1, padding: 16, gap: 8 }}>
      <Text style={{ fontWeight: 'bold' }}>Firefly III</Text>
      <TextInput placeholder="https://firefly.example.com" value={host} onChangeText={setHost} style={{ borderWidth: 1, padding: 8 }} />
      <TextInput placeholder="Personal access token" value={token} onChangeText={setToken} secureTextEntry style={{ borderWidth: 1, padding: 8 }} />
      <Button
        title="Sign in"
        onPress={async () => {
          const result = await signIn(host, token);
          setStatus(result.ok ? `Connected (API ${result.apiVersion})` : `Failed: ${result.reason}`);
          if (!result.ok) Alert.alert('Sign-in failed', result.reason);
        }}
      />
      {status && <Text>{status}</Text>}

      <Text style={{ fontWeight: 'bold', marginTop: 16 }}>Receipt providers</Text>
      <TextInput placeholder="Gemini API key" value={geminiKey} onChangeText={setGeminiKey} secureTextEntry style={{ borderWidth: 1, padding: 8 }} />
      <Button
        title="Save Gemini key"
        onPress={async () => {
          await saveGeminiKey(geminiKey);
          setHasGeminiKey(true);
        }}
      />
      <Text>Gemini key: {hasGeminiKey ? 'set' : 'not set'}</Text>

      <TextInput placeholder="Local model base URL" value={localModelUrl} onChangeText={setLocalModelUrl} style={{ borderWidth: 1, padding: 8 }} />
      <TextInput placeholder="Local model name" value={localModelName} onChangeText={setLocalModelNameState} style={{ borderWidth: 1, padding: 8 }} />
      <Button
        title="Save local model settings"
        onPress={async () => {
          await setLocalModelBaseUrl(db, localModelUrl);
          await setLocalModelName(db, localModelName);
        }}
      />

      <Text style={{ fontWeight: 'bold', marginTop: 16 }}>Defaults</Text>
      <Text>Default source account: {accounts?.find((a) => a.id === defaultAccountId)?.name ?? 'none'}</Text>
      <FlatList
        data={accounts ?? []}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => (
          <Text
            onPress={async () => {
              setDefaultAccountId(item.id);
              await setDefaultSourceAccountId(db, item.id);
            }}
            style={{ paddingVertical: 4, fontWeight: item.id === defaultAccountId ? 'bold' : 'normal' }}
          >
            {item.name}
          </Text>
        )}
      />
      <Text>Default currency: {defaultCurrency ?? 'none'}</Text>
      <FlatList
        data={currencies ?? []}
        keyExtractor={(c) => c.code}
        renderItem={({ item }) => (
          <Text
            onPress={async () => {
              setDefaultCurrency(item.code);
              await setDefaultCurrencyCode(db, item.code);
            }}
            style={{ paddingVertical: 4, fontWeight: item.code === defaultCurrency ? 'bold' : 'normal' }}
          >
            {item.code}
          </Text>
        )}
      />

      <Button title="Sign out" onPress={() => signOut()} color="red" />
    </View>
  );
}
