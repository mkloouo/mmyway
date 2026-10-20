import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import i18n from '../i18n';
import { PhotoViewer } from './PhotoViewer';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function wrap(node: React.ReactElement) {
  return <SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>;
}

describe('PhotoViewer', () => {
  it('renders title "Receipt" and close button when visible', async () => {
    const onClose = jest.fn();
    await render(wrap(<PhotoViewer uri="file:///test/receipt.jpg" onClose={onClose} />));

    expect(screen.getByText(i18n.t('draft.receipt'))).toBeTruthy();
    const closeBtn = screen.getByLabelText(i18n.t('common.close'));
    expect(closeBtn).toBeTruthy();

    fireEvent.press(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders "Remove photo" button when onDelete is provided', async () => {
    const onClose = jest.fn();
    const onDelete = jest.fn();
    await render(
      wrap(<PhotoViewer uri="file:///test/receipt.jpg" onClose={onClose} onDelete={onDelete} />),
    );

    const deleteBtn = screen.getByText(i18n.t('capture.removePhoto'));
    expect(deleteBtn).toBeTruthy();

    fireEvent.press(deleteBtn);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
