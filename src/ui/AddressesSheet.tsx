// One address list per server (design §6.6) — FF3 and the local model both use this, each with
// their own probe function. AddressRow renders an address with status dot and in-use pill.
// AddressEditSheet provides the add/edit sheet (tier B · Edit), while AddressesSheet supports
// multi-address sheets (e.g. for local models).
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { Button, Dot, ListRow, Pill, Sheet } from './kit';
import { confirmDestructive } from './confirm';
import { useTheme } from './theme';
import { TextField } from './TextField';
import { useAction } from './useAction';

export type AddressStatus = 'idle' | 'probing' | 'ok' | 'down' | 'never_reached';

/** Remove and Make primary both rewrite the whole list, so they share one in-flight guard. */
const WRITE_LIST = 'addresses:write-list';

export function AddressRow({
  address,
  active,
  status,
  first,
  onPress,
  trailing,
}: {
  address: string;
  active?: boolean;
  status?: AddressStatus;
  first?: boolean;
  onPress?: () => void;
  trailing?: ReactNode;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  const dotColor =
    status === 'ok'
      ? t.color.income
      : status === 'probing'
        ? t.color.accent
        : active
          ? t.color.income
          : t.color.textFaint;

  const sub =
    status === 'down'
      ? tr('addresses.notReachable')
      : status === 'never_reached'
        ? tr('addresses.neverReached')
        : status === 'probing'
          ? tr('addresses.probing')
          : undefined;

  return (
    <ListRow
      first={first}
      leading={<Dot color={dotColor} />}
      label={address}
      sub={sub}
      trailing={
        trailing ??
        (active ? <Pill label={tr('addresses.inUse')} tone="accent" size="sm" /> : undefined)
      }
      onPress={onPress}
    />
  );
}

export function TestAllButton({
  testing,
  disabled,
  onPress,
}: {
  testing: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={tr('addresses.testAll')}
    >
      <Text
        style={[
          t.type.label,
          {
            fontWeight: '600',
            color: disabled ? t.color.textFaint : t.color.accent,
          },
        ]}
      >
        {testing ? tr('addresses.testing') : tr('addresses.testAll')}
      </Text>
    </Pressable>
  );
}

export function AddressEditSheet({
  visible,
  onClose,
  address,
  isPrimary,
  onSave,
  onRemove,
  onMakePrimary,
  probe,
}: {
  visible: boolean;
  onClose: () => void;
  address: string | null;
  isPrimary?: boolean;
  onSave: (address: string) => Promise<void>;
  onRemove?: (address: string) => Promise<void>;
  onMakePrimary?: (address: string) => Promise<void>;
  probe: (address: string) => Promise<boolean>;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const [value, setValue] = useState(address ?? '');

  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setValue(address ?? '');
    }
  }

  const isEdit = address !== null;
  const title = isEdit ? tr('addresses.editAddressTitle') : tr('addresses.addAddressTitle');
  const saving = act.pending('save');
  const removing = act.pending('remove');
  const makingPrimary = act.pending('makePrimary');
  const busy = saving || removing || makingPrimary;

  const handleSave = act('save', async () => {
    const trimmed = value.trim().replace(/\/+$/, '');
    if (!trimmed) return;
    await probe(trimmed);
    await onSave(trimmed);
  });

  const handleRemove = act('remove', async () => {
    if (!address || !onRemove) return;
    if (!(await confirmDestructive(tr('addresses.removeTitle'), tr('addresses.remove'), address))) {
      return;
    }
    await onRemove(address);
  });

  const handleMakePrimary = act('makePrimary', async () => {
    if (!address || !onMakePrimary) return;
    await onMakePrimary(address);
  });

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      footer={
        <Button
          title={saving ? tr('common.saving') : isEdit ? tr('common.save') : tr('addresses.add')}
          onPress={() => void handleSave()}
          disabled={busy || !value.trim()}
        />
      }
    >
      <View style={{ gap: t.space.md }}>
        <TextField
          value={value}
          onChangeText={setValue}
          placeholder={tr('addresses.urlPlaceholder')}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {isEdit && !isPrimary && onMakePrimary && (
          <Button
            title={makingPrimary ? tr('common.saving') : tr('addresses.makePrimaryAction')}
            variant="secondary"
            onPress={() => void handleMakePrimary()}
            disabled={busy}
          />
        )}
        {isEdit && onRemove && (
          <Button
            title={removing ? tr('common.saving') : tr('addresses.remove')}
            variant="danger"
            onPress={() => void handleRemove()}
            disabled={busy}
          />
        )}
      </View>
    </Sheet>
  );
}

export function SignInSheet({
  visible,
  onClose,
  host,
  token,
  onChangeHost,
  onChangeToken,
  onSubmit,
  signingIn,
}: {
  visible: boolean;
  onClose: () => void;
  host: string;
  token: string;
  onChangeHost: (h: string) => void;
  onChangeToken: (t: string) => void;
  onSubmit: () => void;
  signingIn: boolean;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={tr('settings.fireflyIii')}
      footer={
        <Button
          title={signingIn ? tr('settings.connecting') : tr('settings.signIn')}
          onPress={onSubmit}
          disabled={signingIn}
        />
      }
    >
      <TextField
        value={host}
        onChangeText={onChangeHost}
        placeholder={tr('addresses.ff3UrlPlaceholder')}
        autoCapitalize="none"
      />
      <TextField
        value={token}
        onChangeText={onChangeToken}
        placeholder={tr('settings.tokenPlaceholder')}
        secureTextEntry
        autoCapitalize="none"
        style={{ marginTop: t.space.sm }}
      />
    </Sheet>
  );
}

export function AddressesSheet({
  visible,
  onClose,
  title,
  addresses,
  activeAddress,
  onSave,
  probe,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  addresses: string[];
  activeAddress: string | null;
  onSave: (addresses: string[]) => void | Promise<void>;
  probe: (address: string) => Promise<boolean>;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const [list, setList] = useState(addresses);
  const [status, setStatus] = useState<Record<string, AddressStatus>>({});
  const [newAddress, setNewAddress] = useState('');
  const adding = act.pending(tr('addresses.add'));
  const testingAll = act.pending(tr('addresses.testAll'));
  const busy = act.pending(WRITE_LIST);

  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setList(addresses);
      setStatus({});
    }
  }

  const addAddress = act(tr('addresses.add'), async () => {
    const trimmed = newAddress.trim().replace(/\/+$/, '');
    if (!trimmed) return;
    setStatus((s) => ({ ...s, [trimmed]: 'probing' }));
    const ok = await probe(trimmed);
    const next = [...list, trimmed];
    setList(next);
    setStatus((s) => ({ ...s, [trimmed]: ok ? 'ok' : 'never_reached' }));
    setNewAddress('');
    await onSave(next);
  });

  const removeAddress = act(WRITE_LIST, async (address: string) => {
    if (!(await confirmDestructive(tr('addresses.removeTitle'), tr('addresses.remove'), address)))
      return;
    const next = list.filter((a) => a !== address);
    setList(next);
    await onSave(next);
  });

  const makePrimary = act(WRITE_LIST, async (address: string) => {
    const next = [address, ...list.filter((a) => a !== address)];
    setList(next);
    await onSave(next);
  });

  const testAll = act(tr('addresses.testAll'), async () => {
    setStatus(Object.fromEntries(list.map((a) => [a, 'probing' as AddressStatus])));
    const results = await Promise.all(list.map(async (a) => [a, await probe(a)] as const));
    setStatus(Object.fromEntries(results.map(([a, ok]) => [a, ok ? 'ok' : 'down'])));
  });

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={{ gap: t.space.sm }}>
        {list.map((address) => (
          <View key={address} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <AddressRow
                address={address}
                active={address === activeAddress}
                status={status[address]}
              />
            </View>
            <Pressable
              onPress={() => void makePrimary(address)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={tr('addresses.makePrimary', { address })}
              hitSlop={8}
            >
              <Text style={[t.type.body, { color: t.color.textMuted, opacity: busy ? 0.4 : 1 }]}>
                ▲
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void removeAddress(address)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={tr('addresses.removeAddress', { address })}
              hitSlop={8}
              style={{ marginLeft: t.space.sm }}
            >
              <Text style={[t.type.body, { color: t.color.danger, opacity: busy ? 0.4 : 1 }]}>
                ✕
              </Text>
            </Pressable>
          </View>
        ))}

        <TextField
          value={newAddress}
          onChangeText={setNewAddress}
          placeholder={tr('addresses.urlPlaceholder')}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ marginTop: t.space.sm }}
        />
        <Button
          title={adding ? tr('addresses.adding') : tr('addresses.add')}
          variant="secondary"
          onPress={() => void addAddress()}
          disabled={adding || !newAddress.trim()}
        />
        <Button
          title={testingAll ? tr('addresses.testing') : tr('addresses.testAll')}
          variant="ghost"
          onPress={() => void testAll()}
          disabled={testingAll || list.length === 0}
        />
      </View>
    </Sheet>
  );
}
