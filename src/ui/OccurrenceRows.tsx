// The occurrence list on a planned transaction: what is coming up, what Firefly III already
// booked, and the per-occurrence skip.
//
// "Coming up" is expanded from the repetitions (src/planned/occurrences.ts) rather than read from
// FF3's `repetitions[].occurrences`, for two reasons: FF3 hands over five dates per repetition and
// no parameter raises that, and the list has to follow an edit that has not been saved yet. The
// expander is cross-checked against FF3's own occurrences in a test so the two cannot drift.
//
// "Already booked" is `GET /v1/recurrences/{id}/transactions`, which is the only way to see past
// occurrences — `occurrences` is future-only.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Button, Card, ListRow, SectionHeader } from './kit';
import { useTheme } from './theme';
import { currencyOf, formatMoney } from '../money/format';
import { occurrenceLabel, relativeDayLabel } from '../planned/labels';
import { upcomingOccurrences } from '../planned/occurrences';
import { fetchRecurrenceTransactions } from '../planned/objects';
import type { Repetition } from '../planned/repetition';
import { getClient } from '../api/ff3/session';
import { useDb } from '../providers/DbProvider';
import { useCurrencies } from '../db/useReferenceData';
import { localDay } from '../utils/day';

/** How many occurrences ahead the list shows: enough to see the pattern, short enough to scan. */
const AHEAD = 8;

export function OccurrenceRows({
  repetitions,
  repeats,
  date,
  skipDays,
  recurrenceId,
  sourceAccountId,
  onToggleSkip,
}: {
  repetitions: Repetition[];
  repeats: boolean;
  /** The planned date: the first occurrence the list starts from. */
  date: string;
  skipDays: string[];
  /** FF3's recurrence id, or null when it does not hold one yet — then there is no past half. */
  recurrenceId: string | null;
  sourceAccountId?: string | null;
  onToggleSkip: (day: string) => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const db = useDb();
  const currencies = useCurrencies();
  const today = localDay();
  const from = date > today ? date : today;
  const [showAll, setShowAll] = useState(false);

  // Skipped dates are kept in the list, marked, so one can be put back.
  const allUpcoming = repeats
    ? upcomingOccurrences(repetitions, from, { count: AHEAD })
    : [date].filter((d) => d >= today);
  const ahead = repeats && !showAll ? allUpcoming.slice(0, 3) : allUpcoming;

  const booked = useQuery({
    queryKey: ['recurrence-transactions', recurrenceId],
    enabled: !!recurrenceId,
    queryFn: async () => {
      const client = await getClient(db);
      return client && recurrenceId ? fetchRecurrenceTransactions(client, recurrenceId) : [];
    },
    retry: false,
  });

  return (
    <>
      <SectionHeader
        title={tr('planned.occurrencesAhead')}
        action={
          repeats && allUpcoming.length > 3 ? (
            <Button
              size="bar"
              variant="ghost"
              title={showAll ? tr('planned.showFewer') : tr('planned.showCount', { count: AHEAD })}
              onPress={() => setShowAll((v) => !v)}
            />
          ) : undefined
        }
      />
      <Card flush style={{ marginHorizontal: t.space.lg }}>
        {ahead.length === 0 && (
          <Text style={[t.type.body, { color: t.color.textMuted, padding: t.space.lg }]}>
            {tr('planned.occurrencesNone')}
          </Text>
        )}
        {ahead.map((day, i) => {
          const skipped = skipDays.includes(day);
          return (
            <ListRow
              key={day}
              first={i === 0}
              label={occurrenceLabel(day)}
              sub={skipped ? tr('planned.skipped') : relativeDayLabel(day, today)}
              struck={skipped}
              action={{
                label: skipped ? tr('common.undo') : tr('planned.skipShort'),
                tone: skipped ? 'muted' : 'accent',
                onPress: () => onToggleSkip(day),
              }}
            />
          );
        })}
      </Card>
      <Text
        style={[
          t.type.label,
          { color: t.color.textMuted, paddingHorizontal: t.space.xl, paddingTop: t.space.sm },
        ]}
      >
        {tr('planned.occurrencesHint')}
      </Text>

      {!!recurrenceId && (
        <>
          <SectionHeader
            title={tr('planned.occurrencesBehind')}
            action={
              <Button
                size="bar"
                variant="ghost"
                title={tr('planned.allInActivity')}
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/activity',
                    params: sourceAccountId ? { account: sourceAccountId } : {},
                  })
                }
              />
            }
          />
          <Card flush style={{ marginHorizontal: t.space.lg }}>
            {(booked.data ?? []).length === 0 && (
              <Text style={[t.type.body, { color: t.color.textMuted, padding: t.space.lg }]}>
                {booked.isPending ? tr('common.loading') : tr('planned.occurrencesNoneBehind')}
              </Text>
            )}
            {(booked.data ?? []).map((group, i) => {
              const split = group.attributes.transactions[0];
              if (!split) return null;
              const currency = currencyOf(currencies, split.currency_code ?? '');
              return (
                <ListRow
                  key={group.id}
                  first={i === 0}
                  label={occurrenceLabel(String(split.date ?? '').slice(0, 10))}
                  trailing={
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
                      <Text style={[t.type.body, { color: t.color.textMuted }]}>
                        {formatMoney(split.amount ?? '0', currency)}
                      </Text>
                    </View>
                  }
                  chevron
                  onPress={() =>
                    router.push({
                      pathname: '/transactions/[groupId]',
                      params: { groupId: group.id },
                    })
                  }
                />
              );
            })}
          </Card>
        </>
      )}
    </>
  );
}
