// Firefly III checks and set-up for the Maestro flows, called as
//
//   - runScript:
//       file: ../../scripts/ff3.js
//       env: { ACTION: findTx, PAYEE: "S2 ${RUN_ID}", EXPECT_AMOUNT: "12.34" }
//
// Maestro runs this with its synchronous `http` object and every env var as a global; there is
// no import, so every action lives in this one file. FF3_URL and FF3_TOKEN come from
// scripts/e2e.mjs (the throwaway instance from scripts/ff3-test.mjs), never a real Firefly III.
// A failed check throws, which fails the flow step. Values for later steps go on `output`.
// `node scripts/e2e.mjs selftest` runs every action against the test instance from Node.

/* global http, output */

function v(name, fallback) {
  try {
    var value = eval(name);
    return value === undefined || value === null || value === '' ? fallback : value;
  } catch (e) {
    return fallback;
  }
}

var BASE = v('FF3_URL');
var TOKEN = v('FF3_TOKEN');
if (!BASE || !TOKEN)
  throw new Error('FF3_URL and FF3_TOKEN must be set (run the flows through scripts/e2e.mjs)');

var WAIT_MS = Number(v('TIMEOUT_MS', 30000));

function sleep(ms) {
  var until = Date.now() + ms;
  while (Date.now() < until) {
    // Maestro's script engine has no timers; a short spin is the only way to wait here.
  }
}

function api(method, path, body) {
  var options = {
    method: method,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  var response = http.request(BASE + '/api/v1' + path, options);
  if (response.status < 200 || response.status >= 300)
    throw new Error(
      method + ' ' + path + ' → ' + response.status + ': ' + String(response.body).slice(0, 300),
    );
  return response.body ? JSON.parse(response.body) : null;
}

/** Retries `check` (which returns a value, or null/false to keep waiting) until TIMEOUT_MS. */
function poll(what, check) {
  var until = Date.now() + WAIT_MS;
  var last = null;
  for (;;) {
    try {
      var value = check();
      if (value) return value;
    } catch (e) {
      last = e;
    }
    if (Date.now() > until)
      throw new Error(
        'timed out after ' +
          WAIT_MS / 1000 +
          ' s waiting for ' +
          what +
          (last ? ': ' + last.message : ''),
      );
    sleep(750);
  }
}

function isoDay(date) {
  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function daysFromToday(days) {
  var d = new Date();
  d.setDate(d.getDate() + days);
  return isoDay(d);
}

function all(path) {
  var out = [];
  for (var page = 1; page < 50; page++) {
    var sep = path.indexOf('?') >= 0 ? '&' : '?';
    var r = api('GET', path + sep + 'limit=100&page=' + page);
    out = out.concat(r.data);
    if (!r.meta || !r.meta.pagination || page >= r.meta.pagination.total_pages) break;
  }
  return out;
}

function groups() {
  return all('/transactions?start=' + daysFromToday(-400) + '&end=' + daysFromToday(2));
}

/** Groups picked by DESCRIPTION (a split's description or the group title), PAYEE and/or AMOUNT_IS. */
function matching() {
  var description = v('DESCRIPTION');
  var payee = v('PAYEE');
  var amount = v('AMOUNT_IS');
  if (!description && !payee && !amount)
    throw new Error('set DESCRIPTION, PAYEE or AMOUNT_IS to pick the transaction');
  return groups().filter(function (g) {
    var splits = g.attributes.transactions;
    var byDescription =
      !description ||
      g.attributes.group_title === description ||
      splits.some(function (s) {
        return s.description === description;
      });
    var byPayee =
      !payee ||
      splits.some(function (s) {
        return s.source_name === payee || s.destination_name === payee;
      });
    var byAmount =
      !amount ||
      splits.some(function (s) {
        return Number(s.amount) === Number(amount);
      });
    return byDescription && byPayee && byAmount;
  });
}

function one() {
  var found = matching();
  if (found.length !== 1)
    throw new Error('expected one matching transaction, found ' + found.length);
  return found[0];
}

function same(label, actual, expected) {
  if (expected === undefined) return;
  if (String(actual) !== String(expected))
    throw new Error(label + ': expected "' + expected + '", Firefly III has "' + actual + '"');
}

/** FF3 answers amounts with more decimals ("12.340000000000"); compare as decimals. */
function sameAmount(label, actual, expected) {
  if (expected === undefined) return;
  if (actual === null || actual === undefined || Number(actual) !== Number(expected))
    throw new Error(label + ': expected ' + expected + ', Firefly III has ' + actual);
}

function checkGroup(g) {
  var splits = g.attributes.transactions;
  var s = splits[0];
  same('split count', splits.length, v('EXPECT_SPLITS'));
  same('type', s.type, v('EXPECT_TYPE'));
  sameAmount('amount', s.amount, v('EXPECT_AMOUNT'));
  if (v('EXPECT_TOTAL') !== undefined) {
    var total = splits.reduce(function (sum, x) {
      return sum + Number(x.amount);
    }, 0);
    sameAmount('total', total.toFixed(2), v('EXPECT_TOTAL'));
  }
  same('category', s.category_name, v('EXPECT_CATEGORY'));
  same('source', s.source_name, v('EXPECT_SOURCE'));
  same('destination', s.destination_name, v('EXPECT_DESTINATION'));
  same('description', s.description, v('EXPECT_DESCRIPTION'));
  same('group title', g.attributes.group_title, v('EXPECT_GROUP_TITLE'));
  same('currency', s.currency_code, v('EXPECT_CURRENCY'));
  same('foreign currency', s.foreign_currency_code, v('EXPECT_FOREIGN_CURRENCY'));
  sameAmount('foreign amount', s.foreign_amount, v('EXPECT_FOREIGN_AMOUNT'));
  var tag = v('EXPECT_TAG');
  if (tag && (s.tags || []).indexOf(tag) < 0)
    throw new Error('tag "' + tag + '" missing; tags are ' + JSON.stringify(s.tags));
  if (v('EXPECT_ATTACHMENT') === 'true') {
    var attachments = api('GET', '/transactions/' + g.id + '/attachments').data;
    if (attachments.length === 0) throw new Error('no attachment on transaction ' + g.id);
  }
  return true;
}

function accountByName(name) {
  var found = all('/accounts').filter(function (a) {
    return a.attributes.name === name;
  });
  if (found.length === 0) throw new Error('no account named "' + name + '"');
  return found[0];
}

function budgetsNamed(name) {
  return all('/budgets').filter(function (b) {
    return b.attributes.name === name;
  });
}

/** Decimal strings without trailing zeros: "100.00", "100" and "100.000000000000" all give "100". */
function normDecimal(text) {
  var s = String(text).trim();
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return /^-?0+$/.test(s) ? '0' : s;
}

function sameDecimal(actual, expected) {
  return normDecimal(actual) === normDecimal(expected);
}

/**
 * First and last day (YYYY-MM-DD) of the month MONTHS_AGO months before this one, by the phone's
 * calendar (as src/bucket/period.ts does). The date arithmetic is Date.UTC on whole days, so no
 * timezone shifts a day across a month boundary.
 */
function monthBounds(monthsAgo) {
  var now = new Date();
  var first = new Date(Date.UTC(now.getFullYear(), now.getMonth() - monthsAgo, 1));
  var last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
}

var ACTIONS = {
  ping: function () {
    output.ff3Version = api('GET', '/about').data.version;
  },

  /** Waits for exactly EXPECT_COUNT (default 1) matching transactions, then checks EXPECT_*. */
  findTx: function () {
    var want = Number(v('EXPECT_COUNT', 1));
    var found = poll(
      want + ' transaction(s) matching ' + (v('PAYEE') || v('DESCRIPTION') || v('AMOUNT_IS')),
      function () {
        var list = matching();
        if (list.length !== want) throw new Error('found ' + list.length);
        if (want > 0) list.forEach(checkGroup);
        return list;
      },
    );
    if (found[0]) {
      output.groupId = found[0].id;
      output.journalId = found[0].attributes.transactions[0].transaction_journal_id;
    }
  },

  expectNoTx: function () {
    poll('no transaction matching ' + (v('PAYEE') || v('DESCRIPTION')), function () {
      return matching().length === 0;
    });
  },

  createTx: function () {
    var split = {
      type: v('TYPE', 'withdrawal'),
      date: daysFromToday(-Number(v('DAYS_AGO', 0))),
      amount: v('AMOUNT', '10.00'),
      description: v('DESCRIPTION', 'Maestro'),
      source_name: v('SOURCE', 'Checking'),
      destination_name: v('DESTINATION', v('PAYEE', 'Żabka')),
    };
    if (v('CATEGORY')) split.category_name = v('CATEGORY');
    if (v('BUDGET')) split.budget_name = v('BUDGET');
    var created = api('POST', '/transactions', {
      error_if_duplicate_hash: false,
      apply_rules: false,
      transactions: [split],
    });
    output.groupId = created.data.id;
  },

  /** Changes the one matching transaction the way FF3's web UI would (NEW_AMOUNT, NEW_DESCRIPTION, NEW_CATEGORY, NEW_NOTES). */
  updateTx: function () {
    var g = one();
    var change = { transaction_journal_id: g.attributes.transactions[0].transaction_journal_id };
    if (v('NEW_AMOUNT')) change.amount = v('NEW_AMOUNT');
    if (v('NEW_DESCRIPTION')) change.description = v('NEW_DESCRIPTION');
    if (v('NEW_CATEGORY')) change.category_name = v('NEW_CATEGORY');
    if (v('NEW_NOTES')) change.notes = v('NEW_NOTES');
    api('PUT', '/transactions/' + g.id, { apply_rules: false, transactions: [change] });
  },

  deleteTx: function () {
    api('DELETE', '/transactions/' + one().id);
  },

  /** A daily recurrence starting today; `ff3-test cron` (a host step in e2e.mjs) books it. */
  createRecurrence: function () {
    var title = v('TITLE');
    if (!title) throw new Error('set TITLE');
    var tx = {
      description: title,
      amount: v('AMOUNT', '9.99'),
      currency_code: v('CURRENCY', 'PLN'),
      source_id: accountByName(v('SOURCE', 'Checking')).id,
      destination_id: accountByName(v('DESTINATION', 'Orlen')).id,
    };
    if (v('FOREIGN_AMOUNT')) {
      tx.foreign_amount = v('FOREIGN_AMOUNT');
      tx.foreign_currency_code = v('FOREIGN_CURRENCY', 'EUR');
    }
    var created = api('POST', '/recurrences', {
      type: 'withdrawal',
      title: title,
      first_date: daysFromToday(0),
      repeat_until: '2099-12-31',
      apply_rules: false,
      active: true,
      repetitions: [{ type: 'daily', moment: '', skip: 0, weekend: 1 }],
      transactions: [tx],
    });
    output.recurrenceId = created.data.id;
  },

  /** Counts bills, recurring transactions and rules named NAME (the simple view's trio). */
  expectPlanned: function () {
    var name = v('NAME');
    poll('planned "' + name + '"', function () {
      var bills = all('/bills').filter(function (b) {
        return b.attributes.name === name;
      }).length;
      var recurrences = all('/recurrences').filter(function (r) {
        return r.attributes.title === name;
      }).length;
      var rules = all('/rules').filter(function (r) {
        return r.attributes.title === name;
      }).length;
      same('bills named ' + name, bills, v('EXPECT_BILLS'));
      same('recurring transactions named ' + name, recurrences, v('EXPECT_RECURRENCES'));
      same('rules named ' + name, rules, v('EXPECT_RULES'));
      return true;
    });
  },

  /** output.balance: the account's current balance, e.g. to count a cash envelope 10,00 short. */
  balance: function () {
    output.balance = accountByName(v('NAME')).attributes.current_balance;
  },

  expectAccount: function () {
    var name = v('NAME');
    poll('account "' + name + '"', function () {
      var a = accountByName(name).attributes;
      same('active', a.active, v('EXPECT_ACTIVE'));
      var notes = a.notes || '';
      if (v('EXPECT_NOTES_CONTAINS') && notes.indexOf(v('EXPECT_NOTES_CONTAINS')) < 0)
        throw new Error('notes lack "' + v('EXPECT_NOTES_CONTAINS') + '": ' + notes);
      if (v('EXPECT_NOTES_LACK') && notes.indexOf(v('EXPECT_NOTES_LACK')) >= 0)
        throw new Error('notes still contain "' + v('EXPECT_NOTES_LACK') + '"');
      return true;
    });
  },

  /** Checks a liability's own fields by NAME: EXPECT_TYPE, EXPECT_LIABILITY_TYPE, EXPECT_LIABILITY_DIRECTION, EXPECT_INTEREST (decimal), EXPECT_INTEREST_PERIOD. */
  expectAccountFields: function () {
    var name = v('NAME');
    poll('account "' + name + '" fields', function () {
      var a = accountByName(name).attributes;
      same('type', a.type, v('EXPECT_TYPE'));
      same('liability_type', a.liability_type, v('EXPECT_LIABILITY_TYPE'));
      same('liability_direction', a.liability_direction, v('EXPECT_LIABILITY_DIRECTION'));
      if (v('EXPECT_INTEREST') !== undefined && !sameDecimal(a.interest, v('EXPECT_INTEREST')))
        throw new Error('interest: expected ' + v('EXPECT_INTEREST') + ', Firefly III has ' + a.interest);
      same('interest_period', a.interest_period, v('EXPECT_INTEREST_PERIOD'));
      return true;
    });
  },

  /** Puts an account back the way the seed had it (NAME → NEW_NAME, ACTIVE, NOTES). */
  updateAccount: function () {
    var a = accountByName(v('NAME'));
    var body = {};
    if (v('NEW_NAME')) body.name = v('NEW_NAME');
    if (v('ACTIVE')) body.active = v('ACTIVE') === 'true';
    if (v('NOTES') !== undefined) body.notes = v('NOTES') === '-' ? null : v('NOTES');
    api('PUT', '/accounts/' + a.id, body);
  },

  /** Waits until exactly one budget (envelope) named NAME exists. */
  expectBudget: function () {
    var name = v('NAME');
    poll('budget "' + name + '"', function () {
      same('budgets named ' + name, budgetsNamed(name).length, 1);
      return true;
    });
  },

  /** Waits until no budget named NAME is left (deleted, or renamed away). */
  expectNoBudget: function () {
    var name = v('NAME');
    poll('no budget "' + name + '"', function () {
      same('budgets named ' + name, budgetsNamed(name).length, 0);
      return true;
    });
  },

  /**
   * Waits until budget NAME has a limit of AMOUNT (compared as decimals). With MONTHS_AGO, only the
   * limit starting that many months back counts; without it, any period's limit does.
   */
  expectBudgetLimit: function () {
    var name = v('NAME');
    var amount = v('AMOUNT');
    if (!amount) throw new Error('set AMOUNT');
    var month = v('MONTHS_AGO') === undefined ? null : monthBounds(Number(v('MONTHS_AGO'))).start;
    poll('a limit of ' + amount + ' on budget "' + name + '"', function () {
      var found = budgetsNamed(name);
      same('budgets named ' + name, found.length, 1);
      var limits = all('/budgets/' + found[0].id + '/limits').filter(function (l) {
        return !month || String(l.attributes.start).slice(0, 10) === month;
      });
      var amounts = limits.map(function (l) {
        return l.attributes.amount;
      });
      var hit = amounts.some(function (a) {
        return sameDecimal(a, amount);
      });
      if (!hit)
        throw new Error(
          'limits of "' + name + '"' + (month ? ' for ' + month : '') + ' are ' + JSON.stringify(amounts),
        );
      return true;
    });
  },

  /**
   * Writes a limit the way the app's own POST does: AMOUNT for CURRENCY (default PLN) over the whole
   * month MONTHS_AGO months back (default 0, this month). Used to seed last month's envelopes.
   */
  setBudgetLimit: function () {
    var name = v('NAME');
    var amount = v('AMOUNT');
    if (!amount) throw new Error('set AMOUNT');
    var found = budgetsNamed(name);
    if (found.length !== 1)
      throw new Error('expected one budget named "' + name + '", found ' + found.length);
    var bounds = monthBounds(Number(v('MONTHS_AGO', 0)));
    api('POST', '/budgets/' + found[0].id + '/limits', {
      start: bounds.start,
      end: bounds.end,
      amount: amount,
      currency_code: v('CURRENCY', 'PLN'),
    });
  },
};

var action = v('ACTION');
if (!ACTIONS[action])
  throw new Error('unknown ACTION "' + action + '"; one of ' + Object.keys(ACTIONS).join(', '));
ACTIONS[action]();
