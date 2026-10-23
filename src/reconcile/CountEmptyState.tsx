import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, GroupFooter, SectionHeader, StickyFooter, SwitchRow, Tile } from '../ui/kit';
import { useTheme } from '../ui/theme';
import { hasEnvelopeMarker } from '../accounts/envelopeMarker';
import type { ReferenceAccountRow } from '../accounts/useAssetAccounts';

export function CountEmptyState({
  assetAccounts,
  onCommitEnvelopes,
  keyboardHeight,
}: {
  assetAccounts: ReferenceAccountRow[];
  onCommitEnvelopes: (selectedIds: string[]) => void;
  keyboardHeight: number;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(assetAccounts.filter((a) => hasEnvelopeMarker(a.notes)).map((a) => a.id)),
  );

  const toggleAccount = (id: string, on: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: t.space.lg,
          paddingTop: t.space.lg,
          gap: t.space.xl,
          paddingBottom: t.space.lg + keyboardHeight,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: 'center', gap: t.space.md, paddingTop: t.space.lg }}>
          <Tile icon="wallet-outline" tone="warn" size={72} />
          <Text style={[t.type.heading, { color: t.color.text, textAlign: 'center' }]}>
            {tr('count.emptyTitle')}
          </Text>
          <Text
            style={[t.type.body, { color: t.color.textMuted, textAlign: 'center', maxWidth: 290 }]}
          >
            {tr('count.emptyHint')}
          </Text>
        </View>

        {assetAccounts.length > 0 && (
          <View style={{ gap: t.space.xs }}>
            <SectionHeader title={tr('count.yourAccounts')} />
            <Card flush>
              {assetAccounts.map((a, index) => (
                <SwitchRow
                  key={a.id}
                  first={index === 0}
                  label={a.name}
                  value={selectedIds.has(a.id)}
                  onValueChange={(on) => toggleAccount(a.id, on)}
                />
              ))}
            </Card>
            <GroupFooter>{tr('count.switchHint')}</GroupFooter>
          </View>
        )}
      </ScrollView>

      <StickyFooter>
        {assetAccounts.length === 0 ? (
          <Button
            title={tr('count.goToAccounts')}
            onPress={() => router.push('/settings/accounts')}
            size="lg"
          />
        ) : (
          <Button
            title={tr('count.startCounting')}
            onPress={() => onCommitEnvelopes(Array.from(selectedIds))}
            disabled={selectedIds.size === 0}
            size="lg"
          />
        )}
      </StickyFooter>
    </View>
  );
}
