# Privacy Policy — mmyway

Last updated: September 28, 2026

mmyway is a capture app for your own Firefly III server. Here's the short version: your
entries live on your phone and on the Firefly III server you point it at. I'm not running
a server, I don't have a database, and I'm not collecting your data.

## What the app uses, and why

- **Your Firefly III server** — the app syncs accounts, categories and budgets from it and
  sends the transactions you confirm to it. You choose the address and create the access
  token; the token is kept in the phone's secure storage.
- **Camera / Photo Library / Share sheet** — to capture a receipt. Photos are kept in the
  app's own storage until they are uploaded to your Firefly III server as an attachment.
- **Receipt reading (optional)** — to turn a receipt photo into a draft, the app sends the
  photo to a model you configure: first a local OpenAI-compatible model at an address you
  choose, then Google Gemini with your own API key, if you add one. When Gemini is used,
  the photo goes to Google under
  [Google's terms](https://ai.google.dev/gemini-api/terms). Leave both unset and no photo
  is sent anywhere except your Firefly III server.

Apart from those, nothing leaves your device. There's no analytics SDK, no crash reporting
service, no ads, no third-party tracking, and no account or sign-in with me.

## Data storage & deletion

Entries waiting to be confirmed or synced, your aliases, and a copy of your Firefly III
reference data are stored locally on your device only. The diagnostics log in Settings
stays on the device unless you share it yourself. If you delete the app, all of its local
data goes with it. Data already synced to your Firefly III server stays there, under your
control.

## Changes

If this ever changes (for example, if a future version adds a new service), I'll update
this policy before that ships.

## Contact

Questions about this policy or the app: feedback@mkloouo.com
