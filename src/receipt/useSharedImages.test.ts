import { createTestDb } from '../db/testDb';
import { inboxItems } from '../db/schema';
import { ingestSharedImage } from './useSharedImages';
import * as toDraft from './toDraft';
import { router } from 'expo-router';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

describe('ingestSharedImage', () => {
  beforeEach(() => {
    jest.spyOn(toDraft, 'readReceiptImageBase64').mockResolvedValue('same-image-bytes');
    (router.replace as jest.Mock).mockClear();
  });
  afterEach(() => jest.restoreAllMocks());

  it('ignores a shared file that is not an image', async () => {
    const db = createTestDb();
    await ingestSharedImage(db as any, { path: 'file:///doc.pdf', mimeType: 'application/pdf' });
    expect((await db.select().from(inboxItems))).toHaveLength(0);
  });

  it('two shares of the same image produce one inbox item (content-hash guard)', async () => {
    const db = createTestDb();
    await ingestSharedImage(db as any, { path: 'file:///a.jpg', mimeType: 'image/jpeg' });
    await ingestSharedImage(db as any, { path: 'file:///b.jpg', mimeType: 'image/jpeg' });

    const items = await db.select().from(inboxItems);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('receipt');
  });

  it('a duplicate share opens the existing draft instead of the Inbox', async () => {
    const db = createTestDb();
    await ingestSharedImage(db as any, { path: 'file:///a.jpg', mimeType: 'image/jpeg' });
    const [existing] = await db.select().from(inboxItems);
    (router.replace as jest.Mock).mockClear();

    await ingestSharedImage(db as any, { path: 'file:///b.jpg', mimeType: 'image/jpeg' });
    expect(router.replace).toHaveBeenCalledWith(`/draft/${existing!.id}`);
  });
});
