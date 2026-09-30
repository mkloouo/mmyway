import { captureKeyHeight } from './keyHeight';

describe('captureKeyHeight', () => {
  it('keeps the 1.4:1 keys on a phone in portrait', () => {
    expect(captureKeyHeight({ width: 412, height: 915 })).toBe(68);
  });

  it('shrinks the keys in a window short for its width, such as a pop-up', () => {
    const key = captureKeyHeight({ width: 412, height: 560 });
    expect(key).toBeLessThan(68);
    // Four rows with their margins stay under half the window.
    expect(4 * (key + 8)).toBeLessThanOrEqual(560 / 2);
  });

  it('never goes under the touch size, even in landscape', () => {
    expect(captureKeyHeight({ width: 915, height: 412 })).toBe(44);
  });
});
