// Every feature that can be switched off without a release. Flagsmith feature names match the keys.
// `default` is what ships when Flagsmith is unreachable or not configured, so it must be the safe value.
export const FLAGS = {
  budget: {
    default: false,
    description: 'Budget tab and envelopes (Ready to assign, sinking funds, auto-fill)',
  },
  account_create: {
    default: false,
    description: 'Creating an account or a loan/debt from the app',
  },
  demo_mode: { default: false, description: '"Try it with sample data" (demo) entry point' },
  app_lock: { default: false, description: 'The "Lock the app" setting' },
  record_location: { default: false, description: 'Recording where a transaction was made' },
  payee_nicknames: { default: false, description: 'Settings → Payee nicknames (aliases) page' },
  ff3_rules: { default: false, description: 'Settings → Rules page' },
  reverse_proxy: {
    default: false,
    description: 'Settings → Your Firefly III → Reverse proxy page',
  },
} as const satisfies Record<string, { default: boolean; description: string }>;

export type FlagName = keyof typeof FLAGS;
export type FlagValues = Partial<Record<FlagName, boolean>>;
export const FLAG_NAMES = Object.keys(FLAGS) as FlagName[];

/** True for a key of FLAGS. `in` would also accept inherited names such as `toString`. */
export function isFlagName(name: string): name is FlagName {
  return Object.prototype.hasOwnProperty.call(FLAGS, name);
}
