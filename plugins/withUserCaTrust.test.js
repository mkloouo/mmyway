// The two things that break Firefly III connectivity silently if the plugin drifts: the generated
// network security config, and the <application> attribute pointing at it. A wrong value here is
// only visible on a device build, so it is worth asserting here instead.
const {
  NETWORK_SECURITY_CONFIG_XML,
  setNetworkSecurityConfigAttribute,
} = require('./withUserCaTrust');

describe('network security config', () => {
  it('trusts CAs the device owner installed, as well as the system ones', () => {
    expect(NETWORK_SECURITY_CONFIG_XML).toContain('<certificates src="user" />');
    expect(NETWORK_SECURITY_CONFIG_XML).toContain('<certificates src="system" />');
  });

  it('keeps cleartext permitted, which this file overrides from the manifest', () => {
    // app.config.js's expo-build-properties sets android:usesCleartextTraffic for LAN/tailnet
    // http:// addresses; a network security config takes precedence over it from API 24, so
    // dropping this attribute would break every plain-http instance.
    expect(NETWORK_SECURITY_CONFIG_XML).toContain('cleartextTrafficPermitted="true"');
  });

  it('does not disable certificate verification', () => {
    // There is no legitimate reason for either of these in this app: they would turn every
    // install into a man-in-the-middle away from the user's whole ledger.
    expect(NETWORK_SECURITY_CONFIG_XML).not.toContain('trust-anchors-override');
    expect(NETWORK_SECURITY_CONFIG_XML).not.toMatch(/debug-overrides/);
  });
});

describe('setNetworkSecurityConfigAttribute', () => {
  const manifestWithApplication = () => ({
    manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] },
  });

  it('points the main application at the generated resource', () => {
    const manifest = setNetworkSecurityConfigAttribute(manifestWithApplication());
    expect(manifest.manifest.application[0].$['android:networkSecurityConfig']).toBe(
      '@xml/network_security_config',
    );
  });

  it('leaves the rest of the application node alone', () => {
    const manifest = setNetworkSecurityConfigAttribute(manifestWithApplication());
    expect(manifest.manifest.application[0].$['android:name']).toBe('.MainApplication');
  });

  it('is idempotent, so a second prebuild does not duplicate anything', () => {
    const once = setNetworkSecurityConfigAttribute(manifestWithApplication());
    const twice = setNetworkSecurityConfigAttribute(once);
    expect(Object.keys(twice.manifest.application[0].$).sort()).toEqual([
      'android:name',
      'android:networkSecurityConfig',
    ]);
  });

  it('throws rather than silently skipping when there is no application node', () => {
    expect(() => setNetworkSecurityConfigAttribute({ manifest: {} })).toThrow();
  });
});
