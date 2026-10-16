import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import {
  FieldRow,
  ListRow,
  ModalHeader,
  PushHeader,
  RadioRow,
  Segmented,
  SwitchRow,
  Tile,
} from '../ui/kit';

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

  it('ListRow renders struck, selected, and action button', async () => {
    const onAction = jest.fn();
    await render(
      wrap(<ListRow label="Rent" struck selected action={{ label: 'Skip', onPress: onAction }} />),
    );
    expect(screen.getByText('Rent')).toBeTruthy();
    const actionBtn = screen.getByRole('button', { name: 'Skip' });
    expect(actionBtn).toBeTruthy();
    await fireEvent.press(actionBtn);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('SwitchRow renders with leading tile and switch role', async () => {
    const onValueChange = jest.fn();
    await render(
      wrap(
        <SwitchRow
          label="Lock the app"
          value={true}
          leading={<Tile icon="lock-closed" />}
          onValueChange={onValueChange}
        />,
      ),
    );
    const sw = screen.getByRole('switch', { name: 'Lock the app' });
    expect(sw).toBeTruthy();
    await fireEvent.press(sw);
    expect(onValueChange).toHaveBeenCalledWith(false);
  });

  it('RadioRow renders with radio role and reports press', async () => {
    const onPress = jest.fn();
    await render(
      wrap(<RadioRow label="On day 15" sub="Monthly" selected={true} onPress={onPress} />),
    );
    const radio = screen.getByRole('radio', { name: 'On day 15' });
    expect(radio).toBeTruthy();
    await fireEvent.press(radio);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('FieldRow renders label and input', async () => {
    const onChange = jest.fn();
    await render(wrap(<FieldRow label="Account name" value="Main" onChangeText={onChange} />));
    expect(screen.getByText('Account name')).toBeTruthy();
    expect(screen.getByDisplayValue('Main')).toBeTruthy();
  });
});
