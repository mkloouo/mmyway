import { useTranslation } from 'react-i18next';
import { ScrollView, Text } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, GroupFooter, SectionHeader, SwitchRow } from '../ui/kit';
import { useTheme } from '../ui/theme';
import type { ReferenceAccountRow } from '../accounts/useAssetAccounts';

export function CountEmptyState({
  assetAccounts,
  onToggleEnvelope,
  keyboardHeight,
}: {
  assetAccounts: ReferenceAccountRow[];
  onToggleEnvelope: (accountId: string, name: string, on: boolean) => void;
  keyboardHeight: number;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        padding: t.space.lg,
        gap: t.space.sm,
        paddingBottom: t.space.lg + keyboardHeight,
      }}
    >
      <Text style={[t.type.heading, { color: t.color.text }]}>{tr('count.emptyTitle')}</Text>
      <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('count.emptyHint')}</Text>
      {assetAccounts.length === 0 ? (
        <Button
          title={tr('count.goToAccounts')}
          onPress={() => router.push('/settings/accounts')}
        />
      ) : (
        <>
          <SectionHeader title={tr('count.yourAccounts')} />
          <Card flush>
            {assetAccounts.map((a, index) => (
              <SwitchRow
                key={a.id}
                first={index === 0}
                label={a.name}
                value={false}
                onValueChange={(on) => onToggleEnvelope(a.id, a.name, on)}
              />
            ))}
          </Card>
          <GroupFooter>{tr('count.switchHint')}</GroupFooter>
        </>
      )}
    </ScrollView>
  );
}
