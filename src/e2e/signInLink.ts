// The sign-in link the Maestro flows use (.maestro/subflows/sign-in.yaml): the Dev build opens
//   mmyway-dev://e2e-sign-in?host=<address>&token=<token>
// and is signed in at once, without a keyboard. Typing the token through Maestro is the slow part:
// it presses one key every 75 ms, a Firefly III token is over a thousand characters, and the driver
// gives up on any single command after 120 s.
//
// Only the Dev build answers. A link that signs the app in to whatever server it names is a way to
// point a real install at someone else's Firefly III, and any app or web page on the phone can open
// a link. The Dev build also has a link scheme of its own (app.config.js), so the real app never
// even receives these.
import { FLAG_NAMES, type FlagValues } from '../flags/registry';

/** The `extra.appVariant` values (app.config.js) that answer the link: the `.dev` package. */
const ANSWERING_VARIANTS = ['development', 'preview'];

/** `variant` is `Constants.expoConfig?.extra?.appVariant`; anything but a Dev build says no. */
export function e2eLinksEnabled(variant: unknown): boolean {
  return typeof variant === 'string' && ANSWERING_VARIANTS.includes(variant);
}

type LinkParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

/** The address and token in the link's query. A missing one comes out empty and fails to sign in. */
export function signInLinkParams(params: LinkParams): {
  host: string;
  token: string;
  flags?: string;
} {
  const flagsRaw = params.flags;
  const flags = flagsRaw !== undefined ? first(flagsRaw) : undefined;
  return {
    host: first(params.host),
    token: first(params.token),
    ...(flags !== undefined ? { flags } : {}),
  };
}

/**
 * Parses comma-separated flag names (e.g. `budget,demo_mode`) into FlagValues where named flags
 * are true and all other known flags in FLAG_NAMES are false.
 */
export function parseFlagsParam(raw: string): FlagValues {
  const enabled = new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const overrides: FlagValues = {};
  for (const name of FLAG_NAMES) {
    overrides[name] = enabled.has(name);
  }
  return overrides;
}
