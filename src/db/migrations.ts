// Hand-written glue for drizzle-orm's expo-sqlite migrator, which needs migrations
// bundled at build time (Metro has no runtime filesystem access). Each generated SQL
// file must be imported here explicitly and keyed `m<idx padded to 4 digits>` to match
// journal.entries[].idx (see node_modules/drizzle-orm/expo-sqlite/migrator.js).
// Add one import + one map entry per future `npm run db:generate`.
import journal from './migrations/meta/_journal.json';
// eslint-disable-next-line import/no-unresolved -- inlined as a string by babel-plugin-inline-import
import m0000 from './migrations/0000_petite_prism.sql';

export default {
  journal,
  migrations: { m0000 },
};
