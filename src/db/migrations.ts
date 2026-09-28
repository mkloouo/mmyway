// Hand-written glue for drizzle-orm's expo-sqlite migrator, which needs migrations
// bundled at build time (Metro has no runtime filesystem access). Each generated SQL
// file must be imported here explicitly and keyed `m<idx padded to 4 digits>` to match
// journal.entries[].idx (see node_modules/drizzle-orm/expo-sqlite/migrator.js).
// Add one import + one map entry per future `npm run db:generate`.
import journal from './migrations/meta/_journal.json';
import m0000 from './migrations/0000_petite_prism.sql';
import m0001 from './migrations/0001_mysterious_christian_walker.sql';
import m0002 from './migrations/0002_cool_major_mapleleaf.sql';
import m0003 from './migrations/0003_freezing_ares.sql';
import m0004 from './migrations/0004_needy_jazinda.sql';
import m0005 from './migrations/0005_needy_ink.sql';
import m0006 from './migrations/0006_gray_james_howlett.sql';
import m0007 from './migrations/0007_flippant_dracula.sql';
import m0008 from './migrations/0008_blue_surge.sql';
import m0009 from './migrations/0009_milky_sinister_six.sql';

export default {
  journal,
  migrations: { m0000, m0001, m0002, m0003, m0004, m0005, m0006, m0007, m0008, m0009 },
};
