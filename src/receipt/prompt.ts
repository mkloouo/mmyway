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
      currency:
        currencyCodes.length > 0
          ? nullable({ type: 'string', enum: currencyCodes })
          : { type: ['string', 'null'] },
      merchant: { type: ['string', 'null'] },
      date: {
        type: ['string', 'null'],
        format: 'date',
        description: 'ISO 8601 date, e.g. 2026-08-26',
      },
      time: {
        type: ['string', 'null'],
        pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$',
        description: 'HH:mm, 24-hour, e.g. 20:54',
      },
      category:
        categoryNames.length > 0
          ? nullable({ type: 'string', enum: categoryNames })
          : { type: ['string', 'null'] },
      items: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'count', 'price'],
          properties: {
            title: { type: 'string' },
            count: { type: 'number' },
            price: { type: 'number' },
          },
        },
      },
      currency_exchanges: {
        type: ['array', 'null'],
        description:
          'Currency exchange conversions, if this receipt is from a currency exchange or kantor',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            from_amount: {
              type: ['number', 'null'],
              description: 'Amount of currency sold / given / paid by the customer (money out)',
            },
            from_currency:
              currencyCodes.length > 0
                ? nullable({ type: 'string', enum: currencyCodes })
                : { type: ['string', 'null'] },
            to_amount: {
              type: ['number', 'null'],
              description: 'Amount of currency bought / received by the customer (money in)',
            },
            to_currency:
              currencyCodes.length > 0
                ? nullable({ type: 'string', enum: currencyCodes })
                : { type: ['string', 'null'] },
            fee_amount: {
              type: ['number', 'null'],
              description: 'Dedicated fee or commission charged for this exchange, if any',
            },
            fee_currency:
              currencyCodes.length > 0
                ? nullable({ type: 'string', enum: currencyCodes })
                : { type: ['string', 'null'] },
          },
        },
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
      payment_method: { type: 'string', enum: ['unknown', 'cash', 'card'] },
      card_network: nullable({
        type: 'string',
        enum: ['visa', 'mastercard', 'maestro', 'amex', 'other'],
      }),
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
9. For currency exchange receipts (kantor, exchange bureau, bank exchange):
   - Extract each exchange conversion into \`currency_exchanges\`.
   - \`from_amount\`: amount of currency sold / paid / tendered by the customer (money going out from customer).
   - \`from_currency\`: 3-letter currency code sold / paid (e.g. EUR).
   - \`to_amount\`: amount of currency bought / received by the customer (money coming into customer).
   - \`to_currency\`: 3-letter currency code bought / received (e.g. PLN).
   - \`fee_amount\`: dedicated transaction fee or commission charged for this exchange, if shown.
   - \`fee_currency\`: currency code of the fee.
   - If there are multiple exchange conversions on one receipt, include each one in \`currency_exchanges\`.
   - Set root \`amount\` to the primary exchange's \`from_amount\` and root \`currency\` to \`from_currency\`.
10. Do not invent or guess text, numbers, dates, times, or items that cannot be reasonably determined from the image.
11. If a field cannot be determined, omit it unless the schema requires it.
12. \`confidence\` describes the overall reliability of the extraction:
    - \`high\`: receipt is clear and the transaction details are unambiguous.
    - \`medium\`: most information is readable, but some details are uncertain.
    - \`low\`: receipt is blurry, cropped, partially unreadable, or important transaction details are uncertain.
    - \`none\`: the image is not a receipt or contains no recognizable transaction information.
13. \`payment_method\` — how the receipt was paid:
    - \`cash\`: a cash tender line (GOTÓWKA / ГОТІВКА / CASH) or change given (RESZTA / ЗДАЧА / CHANGE).
    - \`card\`: a card / POS / terminal line (KARTA / КАРТКА / PŁATNOŚĆ KARTĄ / contactless) or a masked card number.
    - \`unknown\`: neither is legible. Never guess.
14. \`card_network\` — only when \`payment_method\` is \`card\` AND the scheme is printed:
    VISA → \`visa\`; MASTERCARD / MC → \`mastercard\`; MAESTRO → \`maestro\`;
    AMEX / AMERICAN EXPRESS → \`amex\`; any other printed scheme → \`other\`.
    Not printed → \`null\`. Always \`null\` for \`cash\` and \`unknown\`.

Important:
- \`amount\` is the final amount paid out of pocket, not a subtotal.
- Bottle deposit refunds & voucher tender (e.g. "BON - zwrot opak", "ZWROT OPAK", "KAUCJA", bottle deposit refund coupons, reverse vending machine vouchers):
  In stores like Biedronka or other supermarkets, bottle return vouchers listed under payment settlement ("ROZLICZENIE PŁATNOŚCI") are tender that reduce the actual out-of-pocket amount paid.
  \`amount\` MUST be the net amount actually paid out of pocket by the customer with real money (cash or card) after deducting all deposit vouchers (e.g. cash paid minus change, card amount charged, or total minus the deposit vouchers).
  For example, if SUMA is 11.45 PLN, and ROZLICZENIE PŁATNOŚCI lists BON - zwrot opak 3.00 PLN and 0.50 PLN (total 3.50 PLN in vouchers), with GOTÓWKA 9.00 PLN and RESZTA 1.05 PLN (net cash paid = 7.95 PLN), \`amount\` MUST be 7.95, and \`payment_method\` is \`cash\`.
  Do not include "BON - zwrot opak" as an item to buy in \`items\`.
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
