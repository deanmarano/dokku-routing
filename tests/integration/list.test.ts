import { describe, it, expect, beforeAll } from 'vitest';
import { DokkuRouting } from '../helpers/dokku';

describe('routing:list', () => {
  let dokku: DokkuRouting;

  beforeAll(() => {
    dokku = new DokkuRouting();
  });

  it('lists every bundled proxy adapter', async () => {
    const data = await dokku.json('list');
    const names = data.proxies.map((p: any) => p.name).sort();
    expect(names).toEqual(['caddy', 'haproxy', 'nginx', 'openresty', 'traefik']);
  });

  it('marks nginx and traefik as fully inspectable', async () => {
    const data = await dokku.json('list');
    const inspection = Object.fromEntries(data.proxies.map((p: any) => [p.name, p.inspection]));
    expect(inspection.nginx).toBe('full');
    expect(inspection.traefik).toBe('full');
    expect(inspection.caddy).toBe('metadata');
  });

  it('reports nginx as installed on a real Dokku host', async () => {
    const data = await dokku.json('list');
    const nginx = data.proxies.find((p: any) => p.name === 'nginx');
    expect(nginx.installed).toBe(true);
  });

  it('renders installed and available sections in text mode', async () => {
    const result = await dokku.exec('list');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Installed');
    expect(result.stdout).toContain('Available');
    expect(result.stdout).toContain('nginx');
  });
});

describe('routing:compare', () => {
  let dokku: DokkuRouting;

  beforeAll(() => {
    dokku = new DokkuRouting();
  });

  it('grades the same capability differently for nginx and traefik', async () => {
    const data = await dokku.json('compare', 'nginx', 'traefik');
    const byKey = Object.fromEntries(data.capabilities.map((c: any) => [c.key, c]));

    // The two headline differences from the design discussion.
    expect(byKey['raw-config'].left).toBe('full');
    expect(byKey['raw-config'].right).toBe('none');
    expect(byKey['middleware'].left).toBe('none');
    expect(byKey['middleware'].right).toBe('full');
    expect(byKey['http3'].right).toBe('full');
  });

  it('covers every registered capability for both sides', async () => {
    const data = await dokku.json('compare', 'nginx', 'caddy');
    for (const cap of data.capabilities) {
      expect(['full', 'partial', 'none']).toContain(cap.left);
      expect(['full', 'partial', 'none']).toContain(cap.right);
    }
    expect(data.capabilities.length).toBeGreaterThan(20);
  });

  it('exits zero in text mode when differences are found', async () => {
    const result = await dokku.exec('compare', 'nginx', 'traefik');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Differences that matter');
  });

  it('exits zero in text mode when there are no differences', async () => {
    const result = await dokku.exec('compare', 'nginx', 'nginx');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('covers everything');
  });

  it('rejects an unknown proxy', async () => {
    const result = await dokku.exec('compare', 'nginx', 'nosuchproxy');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Unknown proxy');
  });

  it('requires two proxies', async () => {
    const result = await dokku.exec('compare', 'nginx');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Usage');
  });
});
