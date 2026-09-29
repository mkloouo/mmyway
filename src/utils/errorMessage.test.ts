import { errorMessage } from './errorMessage';

it('reads an Error message and stringifies anything else', () => {
  expect(errorMessage(new Error('boom'))).toBe('boom');
  expect(errorMessage('boom')).toBe('boom');
  expect(errorMessage(42)).toBe('42');
});
