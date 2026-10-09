import { fireEvent, render, screen } from '@testing-library/react-native';
import { TagsField } from '../ui/TagsField';
import '../i18n';

describe('TagsField', () => {
  it('renders active tags as chips and allows removing them', async () => {
    const onChange = jest.fn();
    await render(<TagsField tags={['groceries', 'food']} onChange={onChange} />);

    expect(screen.getByText('groceries')).toBeTruthy();
    expect(screen.getByText('food')).toBeTruthy();

    await fireEvent.press(screen.getByText('groceries'));
    expect(onChange).toHaveBeenCalledWith(['food']);
  });

  it('adds a tag when comma is typed', async () => {
    const onChange = jest.fn();
    await render(<TagsField tags={['groceries']} onChange={onChange} />);

    const input = screen.getByPlaceholderText('Add tags, comma-separated');
    await fireEvent.changeText(input, 'trip,');
    expect(onChange).toHaveBeenCalledWith(['groceries', 'trip']);
  });

  it('adds a tag on commit/blur', async () => {
    const onChange = jest.fn();
    await render(<TagsField tags={['groceries']} onChange={onChange} />);

    const input = screen.getByPlaceholderText('Add tags, comma-separated');
    await fireEvent.changeText(input, 'vacation');
    await fireEvent(input, 'blur');
    expect(onChange).toHaveBeenCalledWith(['groceries', 'vacation']);
  });

  it('offers suggestions and adds them on tap', async () => {
    const onChange = jest.fn();
    await render(
      <TagsField tags={['groceries']} suggestions={['food', 'vacation']} onChange={onChange} />,
    );

    expect(screen.getByText('+ food')).toBeTruthy();
    expect(screen.getByText('+ vacation')).toBeTruthy();

    await fireEvent.press(screen.getByText('+ vacation'));
    expect(onChange).toHaveBeenCalledWith(['groceries', 'vacation']);
  });
});
