import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { PickerSheet } from '../ui/PickerSheet';

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

describe('PickerSheet', () => {
  it('reports the picked chip, or null for None, and closes', async () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <PickerSheet visible onClose={onClose} title="Budget" noneLabel="None" selected="b1" onSelect={onSelect}
          options={[{ key: 'b1', label: 'Monthly' }, { key: 'b2', label: 'Holidays' }]} />
      </SafeAreaProvider>,
    );
    await fireEvent.press(screen.getByText('Holidays'));
    expect(onSelect).toHaveBeenLastCalledWith('b2');
    await fireEvent.press(screen.getByText('None'));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
