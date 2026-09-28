import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native';
import type { ReactElement } from 'react';
import '../i18n';
import { SearchListSheet } from '../ui/SearchListSheet';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
function wrap(ui: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

const NAMES = ['Żabka', 'Biedronka'];

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

describe('SearchListSheet', () => {
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
});
