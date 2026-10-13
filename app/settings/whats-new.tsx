// Settings → About and help → What's new: the latest released version's CHANGELOG section, bundled
// with the app (src/about/whatsNew.json, written by scripts/release.mjs). Plain text, not translated.
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../src/ui/theme';
import {
  Card,
  ListRow,
  PushHeader,
  SCREEN_TOP_PADDING,
  Screen,
  SectionHeader,
} from '../../src/ui/kit';
import whatsNew from '../../src/about/whatsNew.json';

export default function WhatsNewScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();

  return (
    <Screen>
      <PushHeader
        backLabel={tr('settings.aboutAndHelp')}
        onBack={() => router.back()}
        title={tr('settings.whatsNewIn', { version: whatsNew.version })}
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: t.space.xxl, paddingTop: SCREEN_TOP_PADDING }}
      >
        {whatsNew.sections.map((section, index) => (
          <Fragment key={section.title}>
            <SectionHeader first={index === 0} title={section.title} />
            <Card flush style={{ marginHorizontal: t.space.lg }}>
              {section.items.map((item, i) => (
                <ListRow key={i} first={i === 0} label={item} />
              ))}
            </Card>
          </Fragment>
        ))}
      </ScrollView>
    </Screen>
  );
}
