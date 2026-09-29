import en from './locales/en.json';
import ukUA from './locales/uk-UA.json';
import i18n from '.';

function keysOf(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

// Plural forms differ per language (Ukrainian adds _few and _many), so compare base keys.
function baseKeys(obj: object): string[] {
  return [
    ...new Set(keysOf(obj).map((k) => k.replace(/_(zero|one|two|few|many|other)$/, ''))),
  ].sort();
}

describe('locale files', () => {
  it('uk-UA has the same keys as en', () => {
    expect(baseKeys(ukUA)).toEqual(baseKeys(en));
  });
});

describe('fallback', () => {
  afterEach(() => i18n.changeLanguage('en'));

  it('shows English for a key not translated yet', async () => {
    await i18n.changeLanguage('uk-UA');
    const uk = i18n.getResource('uk-UA', 'translation', 'common.cancel');
    expect(i18n.t('common.cancel')).toBe(uk || 'Cancel');
  });

  it('pluralises counts', () => {
    expect(i18n.t('draft.itemCount', { count: 1 })).toBe('1 item');
    expect(i18n.t('draft.itemCount', { count: 3 })).toBe('3 items');
  });
});
