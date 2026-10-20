import { hitSize } from './layout';

describe('hitSize', () => {
  it('is at least 44 dp for accessible touch targets', () => {
    expect(hitSize).toBeGreaterThanOrEqual(44);
  });
});
