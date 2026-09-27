import { generateId } from './id';

describe('generateId', () => {
  it('generates unique-looking, non-empty ids', () => {
    const a = generateId();
    const b = generateId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(5);
  });
});
