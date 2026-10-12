import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { ListRow, ModalHeader, PushHeader, Segmented } from '../ui/kit';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function wrap(node: React.ReactElement) {
  return <SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>;
}

describe('kit', () => {
  it('PushHeader back press calls onBack', async () => {
    const onBack = jest.fn();
    await render(wrap(<PushHeader backLabel="Accounts" onBack={onBack} title="Cash" />));
    await fireEvent.press(screen.getByLabelText('Accounts'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('ModalHeader renders the step label and ✕ calls onClose', async () => {
    const onClose = jest.fn();
    await render(
      wrap(
        <ModalHeader
          title="New account"
          onClose={onClose}
          step={1}
          steps={2}
          stepLabel="Step 1 of 2"
        />,
      ),
    );
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Segmented press reports the key', async () => {
    const onChange = jest.fn();
    await render(
      wrap(
        <Segmented
          options={[
            { key: 'expense', label: 'Expense' },
            { key: 'income', label: 'Income' },
          ]}
          value="expense"
          onChange={onChange}
        />,
      ),
    );
    await fireEvent.press(screen.getByText('Income'));
    expect(onChange).toHaveBeenLastCalledWith('income');
  });

  it('ListRow press calls onPress', async () => {
    const onPress = jest.fn();
    await render(wrap(<ListRow label="Savings" sub="Bank" chevron onPress={onPress} />));
    await fireEvent.press(screen.getByText('Savings'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
