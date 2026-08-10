import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DokkuRouter } from '../helpers/dokku';

const APP = 'router-contrib-test';
const DROP_IN = '/var/lib/dokku/data/router/contrib/router-test-fixture.sh';

// A stand-in for a plugin like dokku-sso: it declares that it puts forward
// auth in front of one specific app, without dokku-router knowing it exists.
const FIXTURE = `
contrib_app_capabilities() {
  [[ "$1" == "${APP}" ]] || return 0
  printf 'forward-auth\\tprotected by a test fixture\\ttest:protect\\n'
}

contrib_proxy_support() {
  printf 'test-fixture\\tnginx\\tfull\\tauth_request\\n'
  printf 'test-fixture\\ttraefik\\tnone\\tno forwardAuth wiring\\n'
}
`;

describe('third-party capability contributions', () => {
  let dokku: DokkuRouter;

  beforeAll(() => {
    dokku = new DokkuRouter();
    dokku.createTestApp(APP);
    dokku.addDomain(APP, 'router-contrib-test.example.com');
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
    const other = 'router-contrib-other';
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

  it('surfaces declared proxy support in router:list', async () => {
    const data = await dokku.json('list');
    const rows = data.contributions.filter((c: any) => c.plugin === 'test-fixture');
    expect(rows).toHaveLength(2);
    expect(rows.find((r: any) => r.proxy === 'traefik').support).toBe('none');
  });
});
