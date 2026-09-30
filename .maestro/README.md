# Device flows (Maestro)

The device-run checklist, automated: every flow the checklist lists is a Maestro flow here,
driven on a real phone over USB against a throwaway, patched Firefly III — never your real books.

```sh
npm run ff3:test -- fresh          # once: a seeded test Firefly III in Docker (about a minute)
npm run e2e                        # the smoke, every build (S1–S6)
npm run e2e -- release             # everything, before a release
npm run e2e -- --changed           # the smoke + the flows for what this branch changed
npm run e2e -- Q2 P1               # just these
```

Needs: Docker, `adb` (Android platform-tools), [Maestro](https://maestro.mobile.dev)
(`curl -Ls "https://get.maestro.mobile.dev" | bash`), the Dev build installed
(`com.mkloouo.mmyway.dev`, `--apk` installs one; the flows sign in through a link only that build
answers, so it has to be built from a checkout that has `app/e2e-sign-in.tsx`), and the phone on USB
with debugging on. The runner connects the phone to the test instance with `adb reverse`, so
`http://localhost:8080` on the phone is the laptop's Docker.

Results go to `e2e-results/<time>-<run id>/`: `report.md` in the checklist's "Copy results" format
(paste it into the release PR), screenshots, each flow's Maestro log and JUnit XML.

## Layout

| Path                 | What                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `flows/<area>/`      | One file per checklist flow (`S1`…`U1`); `.a`/`.b`/`.c` are parts with a host step between them  |
| `subflows/`          | `ready` (launch, sign in if needed, sync), `capture`, `sync`, `wait-sent`, `open-transaction`, … |
| `scripts/ff3.js`     | Firefly III set-up and checks for `runScript` (`ACTION: findTx`, `createTx`, `expectPlanned`, …) |
| `fixtures/`          | Receipt photos for R1–R3 (`scripts/generate-receipt-fixtures.py`)                                |
| `../scripts/e2e.mjs` | The runner: which flows, their host steps, `--changed`, the report                               |

## How a flow checks its result

Each flow makes its own data, named with the run's `RUN_ID` (`S3 k2x9q1`), and checks the
result **in Firefly III** through `scripts/ff3.js`, not just on screen: a confirm has landed exactly
once, with the right amount, category, accounts, tags or attachment. Every run starts from the seed
snapshot (`tools/ff3-test/seed.json`) and a cleared app, so a flow can rely on the seed's names
(`Checking`, `Cash wallet`, `Żabka`, `Weekly shop`, …). The app is cleared with `pm clear`; a phone
that refuses it (`SecurityException: … CLEAR_APP_USER_DATA`, seen on some vendors' user builds)
needs `--reinstall`, which uninstalls the app and installs `--apk` or the APK pulled off the phone.

`npm run e2e -- selftest` runs every `ff3.js` action against the test instance from Node — no phone
needed — so a Firefly III upgrade that changes the API shows up there first.

## Host steps

What a flow can't do from the phone, the runner does between its parts:

| Flow  | Host step                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------- |
| R1–R3 | Push a fixture photo to the phone and share it into the app (`--manual-share` to do it by hand) |
| Q5    | Kill the app, restore the network, run the WorkManager job (`cmd jobscheduler run`)             |
| P2    | Run Firefly III's cron, which books the recurrences the flow created                            |
| T2    | Switch the phone's Wi-Fi off and on                                                             |
| T4    | Switch the phone's dark mode on and off                                                         |
| T5    | Read the Diagnostics log over `adb run-as` and fail on a token or key in it                     |
| U1    | Install `--previous-apk`, then `--apk` over it                                                  |

Some flows need an option and are reported as skipped without it: R1 a receipt reader
(`--gemini-key`, or `--local-model-url` + `--local-model-name`), T2 `--lan`, T3b `--second-instance`,
U1 `--apk` and `--previous-apk` (both must answer the sign-in link, so the previous release has to be
one built from a checkout that has `app/e2e-sign-in.tsx`).

## Writing and fixing flows

- The app has no test ids except the keypad (`keypad-1`…`keypad-9`, `keypad-0`, `keypad-00`,
  `keypad-decimal`, `keypad-backspace`, `keypad-save`, in `src/ui/Keypad.tsx`); everything else is
  tapped by its English label or accessibility label, as in `src/i18n/locales/en.json`. Renaming a
  string can break a flow — `grep -r "the old text" .maestro`.
- **Don't type long text.** On Android `inputText` presses one key every 75 ms (plus the press
  itself) and a single command is cut off after 120 s, so a string of a thousand-odd characters,
  like a Firefly III token, runs into the cap. `pasteText` doesn't help: it types the text again, it
  doesn't use the phone's clipboard. That is why signing in is a link (`subflows/sign-in.yaml` →
  `app/e2e-sign-in.tsx`), not the token typed into Settings.
- `hideKeyboard` on Android is the Back key (`input keyevent 4`): it closes the keyboard when it is
  up, and otherwise goes back a screen or closes the sheet. Use it right after `inputText`, not on
  spec.
- `maestro studio` shows the phone's view hierarchy and lets you try a selector live.
- `maestro check-syntax <file>` checks a flow without a phone. Inside `${…}` avoid `{`/`}` (the
  parser stops at the first `}`), and quote a value containing `: `.
- The flows were written from the source; the first run on a phone may need selectors tuned.
  Things only a person can judge — the camera shutter, how a screen looks — stay manual: the
  screenshots in the results folder are for that look.
