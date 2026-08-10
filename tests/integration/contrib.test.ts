import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DokkuRouting } from '../helpers/dokku';

const APP = 'routing-contrib-test';
const DROP_IN = '/var/lib/dokku/data/routing/contrib/routing-test-fixture.sh';

// A stand-in for a plugin like dokku-sso: it declares that it puts forward
// auth in front of one specific app, without dokku-routing knowing it exists.
const FIXTURE = `
contrib_app_capabilities() {
  [[ "$1" == "${APP}" ]] || return 0
  printf 'forward-auth\\tprotected by a test fixture\\ttest:protect\\n'
}

contrib_proxy_support() {
  printf 'test-fixture\\tnginx\\tfull\\tauth_request\\n'
  printf 'test-fixture\\ttraefik\\tnone\\tno forwardAuth wiring\\n'
}

contrib_owned_config() {
  echo "/home/dokku/$1/nginx.conf.d/generated-by-plugin.conf"
}
`;

describe('third-party capability contributions', () => {
  let dokku: DokkuRouting;

  beforeAll(() => {
    dokku = new DokkuRouting();
    dokku.createTestApp(APP);
    dokku.addDomain(APP, 'routing-contrib-test.example.com');
    dokku.writeHostFile(DROP_IN, FIXTURE);
  });

  afterAll(async () => {
    dokku.removeHostFile(DROP_IN);
    await dokku.cleanup();
  });

  it('folds a drop-in plugin capability into the app report', async () => {
    const data = await dokku.json('report', APP);
    const auth = data.capabilities.find((c: any) => c.key === 'forward-auth');
    expect(auth).toBeDefined();
    expect(auth.source).toBe('test:protect');
  });

  it('only attributes the capability to the app the plugin named', async () => {
    const other = 'routing-contrib-other';
    dokku.createTestApp(other);
    const data = await dokku.json('report', other);
    expect(data.capabilities.find((c: any) => c.key === 'forward-auth')).toBeUndefined();
  });

  it('blocks migration to a proxy that cannot provide the contributed capability', async () => {
    // haproxy declares forward-auth as unsupported, so the contribution alone
    // is enough to block the move -- no special case for the plugin.
    const result = await dokku.exec('plan', APP, 'haproxy');
    expect(result.stdout).toContain('Forward authentication');
    expect(result.stdout).toContain('Blocked.');
  });

  it('treats a claimed config file as the plugin\'s business, not hand-written', async () => {
    const confDir = `/home/dokku/${APP}/nginx.conf.d`;
    dokku.runHostShell(`mkdir -p ${confDir}`);
    dokku.writeHostFile(`${confDir}/generated-by-plugin.conf`, '# generated\n');
    dokku.writeHostFile(`${confDir}/by-hand.conf`, '# written by a person\n');

    const data = await dokku.json('report', APP);
    const raw = data.capabilities.filter((c: any) => c.key === 'raw-config');

    // The fixture claims generated-by-plugin.conf via contrib_owned_config.
    expect(raw.some((c: any) => c.detail.includes('by-hand.conf'))).toBe(true);
    expect(raw.some((c: any) => c.detail.includes('generated-by-plugin.conf'))).toBe(false);

    dokku.runHostShell(`rm -f ${confDir}/generated-by-plugin.conf ${confDir}/by-hand.conf`);
  });

  it('reports every hand-written file, not just the first', async () => {
    const confDir = `/home/dokku/${APP}/nginx.conf.d`;
    dokku.runHostShell(`mkdir -p ${confDir}`);
    dokku.writeHostFile(`${confDir}/one.conf`, '# one\n');
    dokku.writeHostFile(`${confDir}/two.conf`, '# two\n');

    const data = await dokku.json('report', APP);
    const raw = data.capabilities.filter((c: any) => c.key === 'raw-config');
    expect(raw.some((c: any) => c.detail.includes('one.conf'))).toBe(true);
    expect(raw.some((c: any) => c.detail.includes('two.conf'))).toBe(true);

    dokku.runHostShell(`rm -f ${confDir}/one.conf ${confDir}/two.conf`);
  });

  it('surfaces declared proxy support in routing:list', async () => {
    const data = await dokku.json('list');
    const rows = data.contributions.filter((c: any) => c.plugin === 'test-fixture');
    expect(rows).toHaveLength(2);
    expect(rows.find((r: any) => r.proxy === 'traefik').support).toBe('none');
  });
});
