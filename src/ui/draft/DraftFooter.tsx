import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Button, StatusPill, StickyFooter } from '../kit';
import { useTheme } from '../theme';
import type { DraftReadiness } from '../../inbox/readiness';
import { missingLabel } from '../readinessLabel';

export interface DraftFooterProps {
  readOnly?: boolean;
  rowState: string;
  hasPendingCreate: boolean;
  onCancelSending: () => void;
  isSplit: boolean;
  confirming: boolean;
  readiness: DraftReadiness;
  fxAccountName?: string;
  onAddPart: () => void;
  onConfirm: () => void;
}

export function DraftFooter({
  readOnly,
  rowState,
  hasPendingCreate,
  onCancelSending,
  isSplit,
  confirming,
  readiness,
  fxAccountName,
  onAddPart,
  onConfirm,
}: DraftFooterProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  const hint = (() => {
    if (readiness.ready) return undefined;
    if (
      fxAccountName &&
      readiness.missing.length === 1 &&
      readiness.missing[0] === 'converted amount'
    ) {
      return tr('draft.enterAccountPaid', { account: fxAccountName });
    }
    return missingLabel(readiness.missing);
  })();

  if (readOnly) {
    return (
      <View style={{ alignItems: 'center', padding: t.space.lg, gap: t.space.md }}>
        <StatusPill
          state={rowState === 'synced' ? 'ok' : 'queued'}
          label={rowState === 'synced' ? tr('draft.synced') : tr('draft.queued')}
        />
        {hasPendingCreate && (
          <>
            <Button
              title={tr('draft.cancelSending')}
              variant="secondary"
              onPress={onCancelSending}
            />
            <Text style={[t.type.label, { color: t.color.textMuted, textAlign: 'center' }]}>
              {tr('draft.cancelSendingHint')}
            </Text>
          </>
        )}
      </View>
    );
  }

  return (
    <StickyFooter>
      {isSplit ? (
        <View style={{ flexDirection: 'row', gap: t.space.sm, width: '100%' }}>
          <Button
            title={tr('splits.addPart')}
            variant="secondary"
            onPress={onAddPart}
            disabled={confirming}
            style={{ flex: 1 }}
          />
          <Button
            title={confirming ? tr('draft.confirming') : tr('inbox.confirm')}
            onPress={onConfirm}
            disabled={confirming || !readiness.ready}
            hint={hint}
            style={{ flex: 2 }}
          />
        </View>
      ) : (
        <Button
          title={confirming ? tr('draft.confirming') : tr('inbox.confirm')}
          onPress={onConfirm}
          disabled={confirming || !readiness.ready}
          hint={hint}
          size="lg"
        />
      )}
    </StickyFooter>
  );
}
