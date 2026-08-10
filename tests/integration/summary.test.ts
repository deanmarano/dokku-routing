import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DokkuRouting } from '../helpers/dokku';

const PLAIN = 'routing-summary-plain';
const CUSTOM = 'routing-summary-custom';
const SIGIL = `/home/dokku/${CUSTOM}/nginx.conf.sigil`;

describe('routing (summary)', () => {
  let dokku: DokkuRouting;

  beforeAll(() => {
    dokku = new DokkuRouting();

    dokku.createTestApp(PLAIN);
    dokku.addDomain(PLAIN, 'routing-summary-plain.example.com');

    dokku.createTestApp(CUSTOM);
    dokku.addDomain(CUSTOM, 'routing-summary-custom.example.com');
    dokku.writeHostFile(SIGIL, '# custom vhost\n');
  });

  afterAll(async () => {
    dokku.removeHostFile(SIGIL);
    await dokku.cleanup();
  });

  it('includes every app on the host', async () => {
    const data = await dokku.json('routing');
    const names = data.apps.map((a: any) => a.app);
    expect(names).toContain(PLAIN);
    expect(names).toContain(CUSTOM);
  });

  it('flags which apps carry custom proxy config', async () => {
    const data = await dokku.json('routing');
    const byApp = Object.fromEntries(data.apps.map((a: any) => [a.app, a]));
    expect(byApp[PLAIN].custom_config).toBe(false);
    expect(byApp[CUSTOM].custom_config).toBe(true);
  });

  it('splits targets into clean moves and blocked moves', async () => {
    const data = await dokku.json('routing');
    const byApp = Object.fromEntries(data.apps.map((a: any) => [a.app, a]));

    // A plain app can move anywhere.
    expect(byApp[PLAIN].blocked_for).toEqual([]);
    expect(byApp[PLAIN].can_move_to).toContain('traefik');

    // A custom template blocks the proxies that have no template mechanism.
    expect(byApp[CUSTOM].blocked_for).toContain('traefik');
    expect(byApp[CUSTOM].can_move_to).not.toContain('traefik');
  });

  it('never lists an app as its own migration target', async () => {
    const data = await dokku.json('routing');
    for (const app of data.apps) {
      expect([...app.can_move_to, ...app.blocked_for]).not.toContain(app.proxy);
    }
  });

  it('renders a table with a blocked-moves section in text mode', async () => {
    const result = await dokku.exec('routing');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('CAN MOVE TO');
    expect(result.stdout).toContain(PLAIN);
    expect(result.stdout).toContain('Blocked moves');
  });

  it('says what it is doing before the wait', async () => {
    const result = await dokku.exec('routing');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Inspecting');
  });

  it('keeps the progress notice out of stdout, so json stays parseable', async () => {
    const result = await dokku.exec('routing', '--format', 'json');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('Inspecting');
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it('rejects an unknown --format', async () => {
    const result = await dokku.exec('routing', '--format', 'yaml');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Unknown format');
  });
});
