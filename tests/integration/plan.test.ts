import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DokkuRouting } from '../helpers/dokku';

const PLAIN = 'routing-plan-plain';
const CUSTOM = 'routing-plan-custom';
const SIGIL = `/home/dokku/${CUSTOM}/nginx.conf.sigil`;

describe('routing:plan', () => {
  let dokku: DokkuRouting;

  beforeAll(() => {
    dokku = new DokkuRouting();

    dokku.createTestApp(PLAIN);
    dokku.addDomain(PLAIN, 'routing-plan-plain.example.com');

    dokku.createTestApp(CUSTOM);
    dokku.addDomain(CUSTOM, 'routing-plan-custom.example.com');
    dokku.writeHostFile(SIGIL, '# custom vhost\n');
  });

  afterAll(async () => {
    dokku.removeHostFile(SIGIL);
    await dokku.cleanup();
  });

  it('requires an app and a target proxy', async () => {
    const result = await dokku.exec('plan', PLAIN);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Usage');
  });

  it('rejects an unknown target proxy', async () => {
    const result = await dokku.exec('plan', PLAIN, 'nosuchproxy');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Unknown proxy');
  });

  it('says there is nothing to do when target equals current proxy', async () => {
    const result = await dokku.exec('plan', PLAIN, 'nginx');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('already routed through nginx');
  });

  it('gives a clean verdict for an app using only Dokku-owned routing', async () => {
    const result = await dokku.exec('plan', PLAIN, 'traefik');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('nginx -> traefik');
    expect(result.stdout).toContain('Portable');
    expect(result.stdout).not.toContain('Blocked.');
  });

  it('blocks a move to traefik when the app has a hand-written template', async () => {
    const result = await dokku.exec('plan', CUSTOM, 'traefik');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Unsupported');
    expect(result.stdout).toContain('Blocked.');
    expect(result.stdout).toContain('Hand-written proxy config');
  });

  it('names the exact commands to run, and changes nothing itself', async () => {
    const before = await dokku.json('report', PLAIN);
    const result = await dokku.exec('plan', PLAIN, 'caddy');

    expect(result.stdout).toContain(`dokku proxy:set ${PLAIN} type caddy`);
    expect(result.stdout).toContain('does not change anything');

    const after = await dokku.json('report', PLAIN);
    expect(after.proxy).toBe(before.proxy);
  });

  it('is text only -- --format json is not offered here', async () => {
    // The flag is not parsed by plan, so it lands as a positional arg and the
    // command must not silently succeed with a bogus target.
    const result = await dokku.exec('plan', PLAIN, '--format', 'json');
    expect(result.exitCode).not.toBe(0);
  });
});
