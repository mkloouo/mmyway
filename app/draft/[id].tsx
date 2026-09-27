import { useEffect, useState } from 'react';
import { View, Text, Button } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { eq } from 'drizzle-orm';
import { useDb } from '../../src/providers/DbProvider';
import { inboxItems } from '../../src/db/schema';
import { confirmInboxItem } from '../../src/inbox/createManualEntry';
import type { Draft } from '../../src/inbox/draft';

export default function DraftScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    (async () => {
      const rows = await db.select().from(inboxItems).where(eq(inboxItems.id, id));
      const row = rows[0];
      if (row) setDraft(JSON.parse(row.draftJson));
    })();
  }, [id]);

  if (!draft) return <Text>Loading…</Text>;

  return (
    <View style={{ flex: 1, padding: 16, gap: 8 }}>
      <Text>Amount: {draft.amount} {draft.currencyCode}</Text>
      <Text>Payee: {draft.destinationName} {draft.isNewPayee ? '(new payee)' : ''}</Text>
      <Text>Type: {draft.type}</Text>
      <Button
        title="Confirm"
        disabled={confirming}
        onPress={async () => {
          if (confirming) return;
          setConfirming(true);
          try {
            await confirmInboxItem(db, id);
            router.back();
          } finally {
            setConfirming(false);
          }
        }}
      />
    </View>
  );
}
