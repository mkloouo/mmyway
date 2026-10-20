import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Button, Card, ListRow, SectionHeader, Sheet, Tile } from '../kit';
import { useTheme } from '../theme';
import { TextField } from '../TextField';
import { TagsField } from '../TagsField';
import { SharedWithField } from '../SharedWithField';
import { pickDateTime } from '../pickDate';
import { buildEntryDate } from '../../capture/entryDate';
import { appLocale } from '../../i18n';

export interface CaptureDetails {
  notes: string;
  tags: string[];
  sharedWith: string;
  date: Date;
  dateMode: 'today' | 'yesterday' | 'custom';
}

export interface CaptureDetailsSheetProps {
  visible: boolean;
  onClose: () => void;
  notes: string;
  tags: string[];
  sharedWith: string;
  date: Date;
  dateMode: 'today' | 'yesterday' | 'custom';
  photoUri: string | null;
  recentTags: string[];
  sharedPeople: string[];
  onCommit: (details: CaptureDetails) => void;
  onAttachPhoto: () => void;
  onRemovePhoto: () => void;
}

function CaptureDetailsForm({
  onClose,
  notes,
  tags,
  sharedWith,
  date,
  dateMode,
  photoUri,
  recentTags,
  sharedPeople,
  onCommit,
  onAttachPhoto,
  onRemovePhoto,
}: Omit<CaptureDetailsSheetProps, 'visible'>) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  const [draftNotes, setDraftNotes] = useState(notes);
  const [draftTags, setDraftTags] = useState<string[]>(tags);
  const [draftSharedWith, setDraftSharedWith] = useState(sharedWith);
  const [draftDate, setDraftDate] = useState<Date>(date);
  const [draftDateMode, setDraftDateMode] = useState<'today' | 'yesterday' | 'custom'>(dateMode);

  const commitDetails = () => {
    onCommit({
      notes: draftNotes,
      tags: draftTags,
      sharedWith: draftSharedWith,
      date: draftDate,
      dateMode: draftDateMode,
    });
    onClose();
  };

  const draftDateText =
    draftDateMode === 'today'
      ? tr('capture.today')
      : draftDateMode === 'yesterday'
        ? tr('capture.yesterday')
        : draftDate.toLocaleString(appLocale(), {
            day: 'numeric',
            month: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });

  return (
    <>
      <Card flush>
        <ListRow
          first
          label={tr('capture.when')}
          value={draftDateText}
          chevron
          style={{ paddingHorizontal: t.space.lg }}
          onPress={() => {
            pickDateTime(buildEntryDate(draftDate, new Date()), (picked) => {
              setDraftDate(picked);
              setDraftDateMode('custom');
            });
          }}
        />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 48,
            paddingHorizontal: t.space.lg,
            paddingVertical: t.space.sm,
            borderTopWidth: 1,
            borderTopColor: t.color.border,
          }}
        >
          <Text style={[t.type.body, { width: 92, color: t.color.text }]}>{tr('fields.note')}</Text>
          <TextField
            placeholder={tr('capture.notePlaceholder')}
            value={draftNotes}
            onChangeText={setDraftNotes}
            style={[
              t.type.body,
              {
                flex: 1,
                borderWidth: 0,
                paddingHorizontal: 0,
                backgroundColor: 'transparent',
              },
            ]}
          />
        </View>
        <View
          style={{
            paddingHorizontal: t.space.lg,
            paddingVertical: t.space.md,
            borderTopWidth: 1,
            borderTopColor: t.color.border,
            gap: t.space.sm,
          }}
        >
          <Text style={[t.type.body, { color: t.color.text }]}>{tr('fields.tags')}</Text>
          <TagsField tags={draftTags} onChange={setDraftTags} suggestions={recentTags} />
        </View>
        <View
          style={{
            paddingHorizontal: t.space.lg,
            paddingVertical: t.space.md,
            borderTopWidth: 1,
            borderTopColor: t.color.border,
            gap: t.space.sm,
          }}
        >
          <Text style={[t.type.body, { color: t.color.text }]}>{tr('fields.sharedWith')}</Text>
          <SharedWithField
            value={draftSharedWith}
            onApply={setDraftSharedWith}
            people={sharedPeople}
            live
          />
        </View>
      </Card>
      <SectionHeader title={tr('capture.receiptPhoto')} />
      <Card flush>
        <ListRow
          first
          leading={<Tile icon="camera-outline" tone="muted" size={40} iconSize={20} />}
          label={photoUri ? tr('capture.attached') : tr('capture.attachPhoto')}
          sub={tr('capture.cameraOrLibrary')}
          chevron
          onPress={onAttachPhoto}
        />
      </Card>
      {!!photoUri && (
        <Button title={tr('capture.removePhoto')} variant="ghost" onPress={onRemovePhoto} />
      )}
      <View style={{ marginTop: t.space.lg }}>
        <Button title={tr('common.done')} onPress={commitDetails} />
      </View>
    </>
  );
}

export function CaptureDetailsSheet(props: CaptureDetailsSheetProps) {
  const { t: tr } = useTranslation();

  return (
    <Sheet visible={props.visible} onClose={props.onClose} title={tr('capture.details')}>
      {props.visible && <CaptureDetailsForm {...props} />}
    </Sheet>
  );
}
