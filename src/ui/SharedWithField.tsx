// "Shared with": the comma-separated field, with a chip for each person already shared with
// (src/lookup/sharedPeople.ts). Tapping a chip adds that name or takes it out again; the field
// itself still takes anyone new.
//
// Typing and tapping at the same time: a chip applies to the text as the caller holds it, so on a
// screen whose field commits on blur (the draft's — see TextField's `onCommit`), letters typed and
// not yet committed win when the field finally loses focus. Nothing is lost — the chip is one tap
// away again, and nothing is sent before Confirm.
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Chip } from './components';
import { TextField } from './TextField';
import { useTheme } from './theme';
import { sharedNames, toggleSharedName } from '../transactions/sharedWith';

export function SharedWithField({
  value,
  onApply,
  people,
  live,
}: {
  value: string;
  /** The new text: from a chip at once, and from the field as the screen prefers (`live`). */
  onApply: (text: string) => void;
  /** Who to offer, most recent first — the screen reads them (src/lookup/sharedPeople.ts), the
   *  way every other list this kit draws is handed to it rather than fetched here. */
  people: string[];
  /** Writes every keystroke, for a screen holding the value in its own state (Capture). Without
   *  it the field commits once, on blur or close, the way a stored draft needs. */
  live?: boolean;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const chosen = new Set(sharedNames(value).map((n) => n.toLowerCase()));

  return (
    <>
      <TextField
        placeholder={tr('details.sharedWithPlaceholder')}
        value={value}
        {...(live ? { onChangeText: onApply } : { onCommit: onApply })}
      />
      {people.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          {people.map((name) => (
            <Chip
              key={name}
              label={name}
              selected={chosen.has(name.toLowerCase())}
              onPress={() => onApply(toggleSharedName(value, name))}
            />
          ))}
        </View>
      )}
    </>
  );
}
