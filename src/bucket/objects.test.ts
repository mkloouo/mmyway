import { readBucketRow, bucketKey, type BucketKind } from './objects';

describe('readBucketRow', () => {
  const row = (attributesJson: string) => ({
    key: bucketKey('piggy', '1'),
    kind: 'piggy' as BucketKind,
    ff3Id: '1',
    periodStart: null,
    attributesJson,
    syncedAt: '2026-10-20T12:00:00Z',
  });

  it('reads well-formed bucket object attributes', () => {
    const res = readBucketRow(row(JSON.stringify({ name: 'Vacation', targetAmount: '1000' })));
    expect(res).not.toBeNull();
    expect(res?.attributes).toEqual({ name: 'Vacation', targetAmount: '1000' });
  });

  it('skips malformed JSON without crashing', () => {
    expect(readBucketRow(row('{not-valid-json'))).toBeNull();
  });

  it('skips non-object JSON values (string, number, array)', () => {
    expect(readBucketRow(row('"just a string"'))).toBeNull();
    expect(readBucketRow(row('12345'))).toBeNull();
    expect(readBucketRow(row('[1, 2, 3]'))).toBeNull();
  });
});
