import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native';
import type { ReactElement } from 'react';
import '../i18n';
import { SearchListSheet, UseNewFooter } from '../ui/SearchListSheet';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
function wrap(ui: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

// More than 8 names: the search field only appears past that many options.
const NAMES = [
  'Żabka',
  'Biedronka',
  'Orlen',
  'Aldi',
  'Auchan',
  'Bolt',
  'Lidl',
  'Kaufland',
  'Rossmann',
  'Hebe',
];

function Sheet({ onSelect = jest.fn() }: { onSelect?: (name: string) => void }) {
  return (
    <SearchListSheet
      visible
      onClose={jest.fn()}
      title="Payee"
      placeholder="Search"
      items={(query) => NAMES.filter((n) => n.toLowerCase().includes(query.toLowerCase()))}
      keyOf={(n) => n}
      renderRow={(n) => <Text>{n}</Text>}
      onSelect={onSelect}
    />
  );
}

// 40 names across many first letters, so the sheet splits them into letter sections.
const MANY = Array.from(
  { length: 40 },
  (_, i) => `${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[(i * 7) % 26]}-shop ${String(i).padStart(2, '0')}`,
);

function Chooser({
  names,
  labelOf,
  suggested,
}: {
  names: string[];
  labelOf?: (n: string) => string;
  suggested?: string[];
}) {
  return (
    <SearchListSheet
      visible
      onClose={jest.fn()}
      title="Payee"
      placeholder="Search"
      items={(query) => names.filter((n) => n.toLowerCase().includes(query.toLowerCase()))}
      keyOf={(n) => n}
      labelOf={labelOf}
      suggested={suggested}
      renderRow={(n) => <Text testID="row">{n}</Text>}
      onSelect={jest.fn()}
    />
  );
}

describe('SearchListSheet', () => {
  it("doesn't rank its rows while closed", async () => {
    const items = jest.fn(() => NAMES);
    await wrap(
      <SearchListSheet
        visible={false}
        onClose={jest.fn()}
        title="Payee"
        placeholder="Search"
        items={items}
        keyOf={(n) => n}
        renderRow={(n) => <Text>{n}</Text>}
        onSelect={jest.fn()}
      />,
    );
    expect(items).not.toHaveBeenCalled();
  });

  it('filters as you type and says so when nothing matches', async () => {
    await wrap(<Sheet />);
    expect(screen.getByText('Żabka')).toBeTruthy();
    expect(screen.getByText('Biedronka')).toBeTruthy();

    await fireEvent.changeText(screen.getByPlaceholderText('Search'), 'bie');
    expect(screen.queryByText('Żabka')).toBeNull();
    expect(screen.getByText('Biedronka')).toBeTruthy();

    await fireEvent.changeText(screen.getByPlaceholderText('Search'), 'zzz');
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('hands the tapped row back', async () => {
    const onSelect = jest.fn();
    await wrap(<Sheet onSelect={onSelect} />);
    await fireEvent.press(screen.getByText('Żabka'));
    expect(onSelect).toHaveBeenCalledWith('Żabka');
  });

  it('renders footer action and handles pressing it', async () => {
    const onCreate = jest.fn();
    await wrap(
      <SearchListSheet
        visible
        onClose={jest.fn()}
        title="Payee"
        placeholder="Search"
        items={(query) => (query ? [] : NAMES)}
        keyOf={(n) => n}
        renderRow={(n) => <Text>{n}</Text>}
        onSelect={jest.fn()}
        footer={(trimmed, close) =>
          trimmed ? (
            <UseNewFooter
              label={`Create new "${trimmed}"`}
              onPress={() => {
                onCreate(trimmed);
                close();
              }}
            />
          ) : undefined
        }
      />,
    );

    await fireEvent.changeText(screen.getByPlaceholderText('Search'), 'New Shop');
    expect(screen.getByText('Create new "New Shop"')).toBeTruthy();
    await fireEvent.press(screen.getByText('Create new "New Shop"'));
    expect(onCreate).toHaveBeenCalledWith('New Shop');
  });

  it('sorts A–Z with a letter index above 30 options', async () => {
    await wrap(<Chooser names={MANY} labelOf={(n) => n} />);
    const sorted = [...MANY].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const rendered = screen.getAllByTestId('row').map((r) => String(r.props.children));
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered).toEqual(sorted.slice(0, rendered.length));
    expect(screen.getAllByTestId(/^letter-index-/)).toHaveLength(
      new Set(MANY.map((n) => n.charAt(0))).size,
    );
  });

  it('lists suggested options before the rest', async () => {
    const last = MANY[MANY.length - 1] ?? '';
    await wrap(<Chooser names={MANY} labelOf={(n) => n} suggested={[last]} />);
    const rendered = screen.getAllByTestId('row').map((r) => String(r.props.children));
    expect(rendered[0]).toBe(last);
  });
});
