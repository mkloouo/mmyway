import { useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import { useDb } from '../src/providers/DbProvider';
import { inboxItems } from '../src/db/schema';
import { findDuplicateReceiptItem } from '../src/inbox/draft';
import { parseReceiptItem } from '../src/receipt/toDraft';
import { enqueueOperation } from '../src/sync/outbox';
import { generateId } from '../src/utils/id';
import type { Draft } from '../src/inbox/draft';

async function pickImage(source: 'camera' | 'gallery') {
  const permission = source === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7 })
    : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.7 });
  if (result.canceled || !result.assets[0]?.base64) return null;
  return result.assets[0];
}

export default function ReceiptScreen() {
  const db = useDb();
  const { attachToJournalId } = useLocalSearchParams<{ attachToJournalId?: string }>();
  const [hint, setHint] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function capture(source: 'camera' | 'gallery') {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const asset = await pickImage(source);
      if (!asset?.base64) return;

      // C2: attaching to an already-synced transaction reuses Task 5's attach_receipt
      // operation directly — no inbox item, no parsing, just the upload.
      if (attachToJournalId) {
        await enqueueOperation(db, {
          id: generateId(),
          kind: 'attach_receipt',
          payload: { transactionJournalId: attachToJournalId, receiptImagePath: asset.uri },
        });
        router.back();
        return;
      }

      const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, asset.base64);
      const duplicate = await findDuplicateReceiptItem(db, hash);
      if (duplicate) {
        setStatus('Already captured — opening the existing draft.');
        router.replace(`/draft/${duplicate.id}`);
        return;
      }

      const id = generateId();
      const now = new Date().toISOString();
      const stub: Draft = { type: 'withdrawal', amount: '', currencyCode: '', date: now, description: '', isNewPayee: true };
      await db.insert(inboxItems).values({
        id, kind: 'receipt', state: 'captured', draftJson: JSON.stringify(stub),
        receiptImagePath: asset.uri, receiptContentHash: hash,
        createdAt: now, updatedAt: now,
      });

      // Parse immediately if a provider answers; otherwise the item stays `captured` and
      // runSync retries it on the next sync (brief §5.4 — the image file is kept either way).
      const parsed = await parseReceiptItem(db, id, asset.base64, hint || undefined);
      setStatus(parsed ? 'Parsed — review the draft.' : 'Saved — no receipt provider reachable, will retry on next sync.');
      router.replace(`/draft/${id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: 'bold' }}>{attachToJournalId ? 'Attach receipt' : 'Receipt'}</Text>
      {!attachToJournalId && (
        <TextInput placeholder="Hint for the provider (optional)" value={hint} onChangeText={setHint} style={{ borderWidth: 1, padding: 8 }} />
      )}
      <Button title="Take photo" onPress={() => capture('camera')} disabled={busy} />
      <Button title="Choose from gallery" onPress={() => capture('gallery')} disabled={busy} />
      {status && <Text>{status}</Text>}
    </View>
  );
}
