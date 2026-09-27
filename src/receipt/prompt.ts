// The receipt extraction contract, shared by both providers — the prompt and schema the Telegram
// bot's parser has been running in production, so the app reads receipts the same way.
//
// Categories and currencies are the synced FF3 lists passed in by the caller (AGENTS.md: never
// hardcoded); the bot's copy of this schema hardcoded both.

export function receiptJsonSchema(categoryNames: string[], currencyCodes: string[]) {
  const nullable = <T extends object>(inner: T) => ({ anyOf: [inner, { type: 'null' }] });
  return {
    type: 'object',
    additionalProperties: false,
    required: ['confidence', 'payment_method', 'card_network'],
    properties: {
      amount: { type: ['number', 'null'] },
      currency: currencyCodes.length > 0 ? nullable({ type: 'string', enum: currencyCodes }) : { type: ['string', 'null'] },
      merchant: { type: ['string', 'null'] },
      date: { type: ['string', 'null'], format: 'date', description: 'ISO 8601 date, e.g. 2026-08-26' },
      time: { type: ['string', 'null'], pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$', description: 'HH:mm, 24-hour, e.g. 20:54' },
      category: categoryNames.length > 0 ? nullable({ type: 'string', enum: categoryNames }) : { type: ['string', 'null'] },
      items: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'count', 'price'],
          properties: { title: { type: 'string' }, count: { type: 'number' }, price: { type: 'number' } },
        },
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
      payment_method: { type: 'string', enum: ['unknown', 'cash', 'card'] },
      card_network: nullable({ type: 'string', enum: ['visa', 'mastercard', 'maestro', 'amex', 'other'] }),
    },
  };
}

const PROMPT = `Extract the transaction information from the receipt image.

Rules:
1. Return ONLY valid JSON matching the provided schema. Do not output markdown, explanations, comments, or extra text.
2. Extract the final transaction total into \`amount\`.
3. Extract the receipt currency into \`currency\`.
4. Extract the merchant/store name into \`merchant\`.
5. Extract the transaction date into \`date\` using YYYY-MM-DD.
6. Extract the transaction time into \`time\` using HH:mm, if visible.
7. Assign the most appropriate \`category\` based on the merchant and purchased items.
8. Extract each identifiable purchased item into \`items\`.
   - \`title\`: item/product name as written on the receipt.
   - \`count\`: quantity purchased.
   - \`price\`: price for that item as shown on the receipt.
9. Do not invent or guess text, numbers, dates, times, or items that cannot be reasonably determined from the image.
10. If a field cannot be determined, omit it unless the schema requires it.
11. \`confidence\` describes the overall reliability of the extraction:
    - \`high\`: receipt is clear and the transaction details are unambiguous.
    - \`medium\`: most information is readable, but some details are uncertain.
    - \`low\`: receipt is blurry, cropped, partially unreadable, or important transaction details are uncertain.
    - \`none\`: the image is not a receipt or contains no recognizable transaction information.
12. \`payment_method\` — how the receipt was paid:
    - \`cash\`: a cash tender line (GOTÓWKA / ГОТІВКА / CASH) or change given (RESZTA / ЗДАЧА / CHANGE).
    - \`card\`: a card / POS / terminal line (KARTA / КАРТКА / PŁATNOŚĆ KARTĄ / contactless) or a masked card number.
    - \`unknown\`: neither is legible. Never guess.
13. \`card_network\` — only when \`payment_method\` is \`card\` AND the scheme is printed:
    VISA → \`visa\`; MASTERCARD / MC → \`mastercard\`; MAESTRO → \`maestro\`;
    AMEX / AMERICAN EXPRESS → \`amex\`; any other printed scheme → \`other\`.
    Not printed → \`null\`. Always \`null\` for \`cash\` and \`unknown\`.

Important:
- \`amount\` is the final amount paid, not a subtotal.
- \`items[].price\` is the price of one line item as printed on the receipt. Do not calculate or reconstruct prices unless the receipt explicitly provides enough information.
- For weighted products, \`count\` may be fractional, for example 0.75.
- Do not confuse item quantity with price.
- \`payment_method\` and \`card_network\` describe the tender, not the goods. If the receipt shows both a card line and "cash back", it is still \`card\`.
- If the image is not a receipt, return \`confidence: "none"\` and leave all other optional fields absent.`;

/** The prompt, with the user's optional hint appended the way the bot appended a photo caption. */
export function receiptPrompt(hint?: string): string {
  const note = hint?.trim();
  return note
    ? `${PROMPT}\nThe sender attached this note - treat it as a hint, not as fact to prefer over the image: "${note.replace(/"/g, '\\"')}"`
    : PROMPT;
}
