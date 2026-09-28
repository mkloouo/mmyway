// One address list per server (design §6.6) — FF3 and the local model both use this, each with
// their own probe function. Every action (add/remove/reorder) persists immediately; there is no
// separate Save.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { Sheet, Button } from './components';
import { confirmDestructive } from './confirm';
import { useTheme } from './theme';
import { TextField } from './TextField';

type Status = 'idle' | 'probing' | 'ok' | 'down' | 'never_reached';

export function AddressesSheet({
  visible, onClose, title, addresses, activeAddress, onSave, probe,
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
  const [list, setList] = useState(addresses);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [newAddress, setNewAddress] = useState('');
  const [adding, setAdding] = useState(false);
  const [testingAll, setTestingAll] = useState(false);
  /** Reorder and remove both write the whole list — a second tap mid-write would race it. */
  const [busy, setBusy] = useState(false);

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

  async function addAddress() {
    const trimmed = newAddress.trim().replace(/\/+$/, '');
    if (!trimmed || adding) return;
    setAdding(true);
    setStatus((s) => ({ ...s, [trimmed]: 'probing' }));
    try {
      const ok = await probe(trimmed);
      const next = [...list, trimmed];
      setList(next);
      setStatus((s) => ({ ...s, [trimmed]: ok ? 'ok' : 'never_reached' }));
      setNewAddress('');
      await onSave(next);
    } finally {
      setAdding(false);
    }
  }

  async function removeAddress(address: string) {
    if (busy) return;
    if (!await confirmDestructive(tr('addresses.removeTitle'), tr('addresses.remove'), address)) return;
    setBusy(true);
    try {
      const next = list.filter((a) => a !== address);
      setList(next);
      await onSave(next);
    } finally {
      setBusy(false);
    }
  }

  async function makePrimary(address: string) {
    if (busy) return;
    setBusy(true);
    try {
      const next = [address, ...list.filter((a) => a !== address)];
      setList(next);
      await onSave(next);
    } finally {
      setBusy(false);
    }
  }

  async function testAll() {
    if (testingAll) return;
    setTestingAll(true);
    setStatus(Object.fromEntries(list.map((a) => [a, 'probing' as Status])));
    try {
      const results = await Promise.all(list.map(async (a) => [a, await probe(a)] as const));
      setStatus(Object.fromEntries(results.map(([a, ok]) => [a, ok ? 'ok' : 'down'])));
    } finally {
      setTestingAll(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={{ gap: t.space.sm }}>
        {list.map((address) => (
          <View key={address} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor(status[address]) }} />
            <Text style={[t.type.body, { color: t.color.text, flex: 1 }]} numberOfLines={1}>{address}</Text>
            {address === activeAddress && <Text style={[t.type.label, { color: t.color.accent }]}>{tr('addresses.inUse')}</Text>}
            {status[address] === 'never_reached' && <Text style={[t.type.label, { color: t.color.warn }]}>{tr('addresses.neverReached')}</Text>}
            <Pressable onPress={() => makePrimary(address)} disabled={busy} accessibilityRole="button" accessibilityLabel={tr('addresses.makePrimary', { address })}>
              <Text style={[t.type.body, { color: t.color.textMuted, opacity: busy ? 0.4 : 1 }]}>▲</Text>
            </Pressable>
            <Pressable onPress={() => removeAddress(address)} disabled={busy} accessibilityRole="button" accessibilityLabel={tr('addresses.removeAddress', { address })}>
              <Text style={[t.type.body, { color: t.color.danger, opacity: busy ? 0.4 : 1 }]}>✕</Text>
            </Pressable>
          </View>
        ))}

        <View style={{ flexDirection: 'row', gap: t.space.sm, alignItems: 'center', paddingTop: t.space.sm }}>
          <TextField
            value={newAddress}
            onChangeText={setNewAddress}
            placeholder="https://…"
            autoCapitalize="none"
            autoCorrect={false}
            style={{ flex: 1 }}
          />
        </View>
        <Button title={adding ? tr('addresses.adding') : tr('addresses.add')} variant="secondary" onPress={addAddress} disabled={adding || !newAddress.trim()} />
        <Button title={testingAll ? tr('addresses.testing') : tr('addresses.testAll')} variant="ghost" onPress={testAll} disabled={testingAll || list.length === 0} />
      </View>
    </Sheet>
  );
}
