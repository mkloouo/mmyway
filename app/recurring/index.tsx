import { View, Text, Button, FlatList } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { eq } from 'drizzle-orm';
import { useDb } from '../../src/providers/DbProvider';
import { inboxItems } from '../../src/db/schema';
import { approveRecurringReview } from '../../src/sync/recurringReview';

export default function RecurringReviewScreen() {
  const db = useDb();
  const { data } = useLiveQuery(db.select().from(inboxItems).where(eq(inboxItems.kind, 'recurring_review')));
  const pending = (data ?? []).filter((item) => item.state === 'confirmed');

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <FlatList
        data={pending}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const journal = JSON.parse(item.draftJson);
          return (
            <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: '#ddd' }}>
              <Text>{journal.description} · {journal.amount} {journal.currency_code}</Text>
              <Button title="Approve" onPress={() => approveRecurringReview(db, item.id)} />
            </View>
          );
        }}
      />
    </View>
  );
}
