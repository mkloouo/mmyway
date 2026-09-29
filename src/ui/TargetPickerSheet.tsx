// Payee alias targets: FF3's expense accounts, or a name FF3 will create on first use. Storing
// the account id is what lets a matched withdrawal send destination_id (design §3.4).
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from '../db/useLiveQuery';
import { SearchListSheet, UseNewFooter } from './SearchListSheet';
import { useTheme } from './theme';
import { useDb } from '../providers/DbProvider';
import { referenceAccounts } from '../db/schema';
import { normkey } from '../lookup/normkey';

export interface AliasTarget {
  targetId: string | null;
  targetName: string;
}

function useCandidates(enabled: boolean): AliasTarget[] {
  const db = useDb();
  const { data: accounts } = useLiveQuery(
    db.select().from(referenceAccounts).where(eq(referenceAccounts.type, 'expense')),
    [],
    enabled,
  );
  return useMemo(
    () => (accounts ?? []).map((a) => ({ targetId: a.id, targetName: a.name })),
    [accounts],
  );
}

export function TargetPickerSheet({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (target: AliasTarget) => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const candidates = useCandidates(visible);

  const match = (query: string) => {
    const trimmed = query.trim();
    return trimmed
      ? candidates.filter((c) => normkey(c.targetName).includes(normkey(trimmed)))
      : candidates;
  };

  return (
    <SearchListSheet
      visible={visible}
      onClose={onClose}
      title={tr('payeeSheet.payee.choose')}
      placeholder={tr('payeeSheet.payee.search')}
      items={match}
      keyOf={(item) => item.targetId ?? item.targetName}
      onSelect={onSelect}
      renderRow={(item) => (
        <Text style={[t.type.body, { color: t.color.text }]} numberOfLines={1}>
          {item.targetName}
        </Text>
      )}
      footer={(trimmed, close) =>
        // A payee FF3 doesn't have yet is fine: the expense account is created on first use.
        trimmed && !match(trimmed).some((c) => normkey(c.targetName) === normkey(trimmed)) ? (
          <UseNewFooter
            label={tr('pickers.useNew', { name: trimmed })}
            onPress={() => {
              onSelect({ targetId: null, targetName: trimmed });
              close();
            }}
          />
        ) : undefined
      }
    />
  );
}
