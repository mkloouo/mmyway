export function normkey(input: string): string {
  const folded = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics from NFKD
    .toLowerCase()
    .replace(/ł/g, 'l');
  // Keep ASCII alphanumerics and Cyrillic (U+0400–U+04FF); drop everything else (spaces, punctuation).
  return folded.replace(/[^a-z0-9Ѐ-ӿ]/g, '');
}
