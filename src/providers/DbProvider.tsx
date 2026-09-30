import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, InteractionManager, ScrollView, Share, Text, View } from 'react-native';
import { warmMerchantLookup } from '../lookup/merchantLookup';
import { getDb, getMigrationDone, schema } from '../db/client';
import { useTheme } from '../ui/theme';
import { Button } from '../ui/components';
import { shareableLog } from '../utils/log';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';

type Db = ExpoSQLiteDatabase<typeof schema>;
const DbContext = createContext<Db | null>(null);

export function DbProvider({ children }: { children: ReactNode }) {
  // getDb() is synchronous and memoizes its own instance — no effect needed, and the lazy
  // useState initializer runs it exactly once, on mount, not on every render.
  const [db] = useState<Db>(() => getDb());
  const [migrated, setMigrated] = useState(false);
  const [migrationError, setMigrationError] = useState<Error | null>(null);
  const t = useTheme();
  const { t: tr } = useTranslation();

  useEffect(() => {
    // getMigrationDone() resolves with the migration's error (or null); it doesn't reject.
    void getMigrationDone().then((error) => {
      setMigrationError(error);
      setMigrated(true);
      if (error) return;
      // Preload capture's payee/account history once the first screen has drawn, so the first
      // +Add of the session opens as fast as later ones instead of scanning the cache on open.
      InteractionManager.runAfterInteractions(() => {
        warmMerchantLookup(db).catch(() => undefined);
      });
    });
  }, [db]);

  // Gates every screen behind migrations finishing — querying an unmigrated db races table
  // creation (see getMigrationDone's comment). A bare <Text> here used to land unstyled in the
  // corner under the status bar; fill the screen with the app background and centre a spinner.
  if (!migrated) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: t.color.bg,
        }}
      >
        <ActivityIndicator color={t.color.accent} accessibilityLabel={tr('common.loading')} />
      </View>
    );
  }

  // A failed migration leaves a schema every query trips over in ways that look unrelated, so the
  // app stops here and offers the Diagnostics log instead of running on it.
  if (migrationError) {
    return (
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          gap: t.space.lg,
          padding: t.space.xxl,
        }}
        style={{ backgroundColor: t.color.bg }}
      >
        <Text style={[t.type.heading, { color: t.color.text }]}>{tr('migrationFailed.title')}</Text>
        <Text style={[t.type.body, { color: t.color.textMuted }]}>
          {tr('migrationFailed.body')}
        </Text>
        <Text style={[t.type.label, { color: t.color.danger }]} selectable>
          {migrationError.message}
        </Text>
        <Button
          title={tr('migrationFailed.share')}
          onPress={() => {
            void Share.share({ message: shareableLog() });
          }}
        />
      </ScrollView>
    );
  }

  return <DbContext.Provider value={db}>{children}</DbContext.Provider>;
}

export function useDb(): Db {
  const db = useContext(DbContext);
  if (!db) throw new Error('useDb() called outside DbProvider');
  return db;
}
