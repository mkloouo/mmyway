import { useState } from 'react';
import { View, Text, TextInput, Button, Alert } from 'react-native';
import { signIn, signOut } from '../../src/api/ff3/auth';
import { saveGeminiKey } from '../../src/settings/secrets';

export default function SettingsScreen() {
  const [host, setHost] = useState('');
  const [token, setToken] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [status, setStatus] = useState<string | null>(null);

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

      <Text style={{ fontWeight: 'bold', marginTop: 16 }}>Receipt provider</Text>
      <TextInput placeholder="Gemini API key" value={geminiKey} onChangeText={setGeminiKey} secureTextEntry style={{ borderWidth: 1, padding: 8 }} />
      <Button title="Save Gemini key" onPress={() => saveGeminiKey(geminiKey)} />

      <Button title="Sign out" onPress={() => signOut()} color="red" />
    </View>
  );
}
