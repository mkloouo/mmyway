// One address list per server (design §6.6) — FF3 and the local model both use this, each with
// their own probe function. Every action (add/remove/reorder) persists immediately; there is no
// separate Save.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { Dot, Sheet, Button } from './components';
import { confirmDestructive } from './confirm';
import { useTheme } from './theme';
import { TextField } from './TextField';
import { useAction } from './useAction';

type Status = 'idle' | 'probing' | 'ok' | 'down' | 'never_reached';

/** Remove and Make primary both rewrite the whole list, so they share one in-flight guard. */
const WRITE_LIST = 'addresses:write-list';

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
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [newAddress, setNewAddress] = useState('');
  const adding = act.pending(tr('addresses.add'));
  const testingAll = act.pending(tr('addresses.testAll'));
  /** Reorder and remove both write the whole list — a second tap mid-write would race it. */
  const busy = act.pending(WRITE_LIST);

  // Reset the working copy whenever the sheet opens — adjusted during render (React's documented
  // pattern for this), not in an effect.
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setList(addresses);
      setStatus({});
    }
  }

  function dotColor(s: Status | undefined): string {
    if (s === 'ok') return t.color.income;
    if (s === 'probing') return t.color.accent;
    return t.color.textFaint; // idle, down, never_reached
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
    setStatus(Object.fromEntries(list.map((a) => [a, 'probing' as Status])));
    const results = await Promise.all(list.map(async (a) => [a, await probe(a)] as const));
    setStatus(Object.fromEntries(results.map(([a, ok]) => [a, ok ? 'ok' : 'down'])));
  });

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={{ gap: t.space.sm }}>
        {list.map((address) => (
          <View
            key={address}
            style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}
          >
            <Dot color={dotColor(status[address])} />
            <Text style={[t.type.body, { color: t.color.text, flex: 1 }]} numberOfLines={1}>
              {address}
            </Text>
            {address === activeAddress && (
              <Text style={[t.type.label, { color: t.color.accent }]}>{tr('addresses.inUse')}</Text>
            )}
            {status[address] === 'never_reached' && (
              <Text style={[t.type.label, { color: t.color.warn }]}>
                {tr('addresses.neverReached')}
              </Text>
            )}
            <Pressable
              onPress={() => void makePrimary(address)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={tr('addresses.makePrimary', { address })}
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
          placeholder="https://…"
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
