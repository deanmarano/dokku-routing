import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DokkuRouter } from '../helpers/dokku';

const PLAIN = 'router-summary-plain';
const CUSTOM = 'router-summary-custom';
const SIGIL = `/home/dokku/${CUSTOM}/nginx.conf.sigil`;

describe('router (summary)', () => {
  let dokku: DokkuRouter;

  beforeAll(() => {
    dokku = new DokkuRouter();

    dokku.createTestApp(PLAIN);
    dokku.addDomain(PLAIN, 'router-summary-plain.example.com');

    dokku.createTestApp(CUSTOM);
    dokku.addDomain(CUSTOM, 'router-summary-custom.example.com');
    dokku.writeHostFile(SIGIL, '# custom vhost\n');
  });

  afterAll(async () => {
    dokku.removeHostFile(SIGIL);
    await dokku.cleanup();
  });

  it('includes every app on the host', async () => {
    const data = await dokku.json('router');
    const names = data.apps.map((a: any) => a.app);
    expect(names).toContain(PLAIN);
    expect(names).toContain(CUSTOM);
  });

  it('flags which apps carry custom proxy config', async () => {
    const data = await dokku.json('router');
    const byApp = Object.fromEntries(data.apps.map((a: any) => [a.app, a]));
    expect(byApp[PLAIN].custom_config).toBe(false);
    expect(byApp[CUSTOM].custom_config).toBe(true);
  });

  it('splits targets into clean moves and blocked moves', async () => {
    const data = await dokku.json('router');
    const byApp = Object.fromEntries(data.apps.map((a: any) => [a.app, a]));

    // A plain app can move anywhere.
    expect(byApp[PLAIN].blocked_for).toEqual([]);
    expect(byApp[PLAIN].can_move_to).toContain('traefik');

    // A custom template blocks the proxies that have no template mechanism.
    expect(byApp[CUSTOM].blocked_for).toContain('traefik');
    expect(byApp[CUSTOM].can_move_to).not.toContain('traefik');
  });

  it('never lists an app as its own migration target', async () => {
    const data = await dokku.json('router');
    for (const app of data.apps) {
      expect([...app.can_move_to, ...app.blocked_for]).not.toContain(app.proxy);
    }
  });

  it('renders a table with a blocked-moves section in text mode', async () => {
    const result = await dokku.exec('router');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('CAN MOVE TO');
    expect(result.stdout).toContain(PLAIN);
    expect(result.stdout).toContain('Blocked moves');
  });

  it('rejects an unknown --format', async () => {
    const result = await dokku.exec('router', '--format', 'yaml');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Unknown format');
  });
});
