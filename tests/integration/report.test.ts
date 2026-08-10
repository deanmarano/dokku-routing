import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DokkuRouting } from '../helpers/dokku';

const APP = 'routing-report-test';
const SIGIL = `/home/dokku/${APP}/nginx.conf.sigil`;

describe('routing:report', () => {
  let dokku: DokkuRouting;

  beforeAll(() => {
    dokku = new DokkuRouting();
    dokku.createTestApp(APP);
    dokku.addDomain(APP, 'routing-report-test.example.com');
    dokku.setNginxProperty(APP, 'client-max-body-size', '25m');
    dokku.setNginxProperty(APP, 'proxy-read-timeout', '120s');
  });

  afterAll(async () => {
    dokku.removeHostFile(SIGIL);
    await dokku.cleanup();
  });

  it('fails for an app that does not exist', async () => {
    const result = await dokku.exec('report', 'routing-report-nonexistent');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('does not exist');
  });

  it('identifies the current proxy', async () => {
    const data = await dokku.json('report', APP);
    expect(data.app).toBe(APP);
    expect(data.proxy).toBe('nginx');
  });

  it('detects the domain it was given', async () => {
    const data = await dokku.json('report', APP);
    const domains = data.capabilities.find((c: any) => c.key === 'domains');
    expect(domains).toBeDefined();
    expect(domains.detail).toContain('routing-report-test.example.com');
    expect(domains.source).toBe('domains');
  });

  it('detects nginx:set properties as their own capabilities', async () => {
    const data = await dokku.json('report', APP);
    const byKey = Object.fromEntries(data.capabilities.map((c: any) => [c.key, c]));

    expect(byKey['body-size-limit'].detail).toContain('25m');
    expect(byKey['body-size-limit'].source).toBe('nginx:set');
    expect(byKey['proxy-timeouts'].detail).toContain('120s');
  });

  it('classifies Dokku-owned state as portable to every target', async () => {
    const data = await dokku.json('report', APP);
    for (const target of Object.keys(data.portability)) {
      const domains = data.portability[target].find((c: any) => c.key === 'domains');
      expect(domains.classification).toBe('portable');
    }
  });

  it('classifies an nginx body-size limit as translatable to caddy but manual for traefik', async () => {
    const data = await dokku.json('report', APP);
    const find = (target: string, key: string) =>
      data.portability[target].find((c: any) => c.key === key);

    // traefik grades body-size-limit as partial, so it needs a human.
    expect(find('traefik', 'body-size-limit').classification).toBe('manual');
    expect(find('traefik', 'body-size-limit').target_support).toBe('partial');
  });

  it('does not list the current proxy as a migration target', async () => {
    const data = await dokku.json('report', APP);
    expect(Object.keys(data.portability)).not.toContain('nginx');
  });

  it('flags a custom nginx template without parsing it', async () => {
    dokku.writeHostFile(SIGIL, '# a template we deliberately do not parse\n');

    const data = await dokku.json('report', APP);
    const raw = data.capabilities.find((c: any) => c.key === 'raw-config');
    expect(raw).toBeDefined();
    expect(raw.detail).toContain('nginx.conf.sigil');

    // Hand-written config is opaque: never auto-translated, and blocked where
    // the target proxy has no template mechanism at all.
    const traefik = data.portability.traefik.find((c: any) => c.key === 'raw-config');
    expect(traefik.classification).toBe('unsupported');
    const caddy = data.portability.caddy.find((c: any) => c.key === 'raw-config');
    expect(caddy.classification).toBe('manual');
  });

  it('does not mistake a letsencrypt-managed cert for an operator-supplied one', async () => {
    const tls = `/home/dokku/${APP}/tls`;
    dokku.runHostShell(`mkdir -p ${tls}`);
    dokku.writeHostFile(`${tls}/server.crt`, 'not a real certificate\n');

    let data = await dokku.json('report', APP);
    expect(data.capabilities.find((c: any) => c.key === 'tls')).toBeDefined();
    expect(data.capabilities.find((c: any) => c.key === 'tls-custom-cert')).toBeDefined();

    // dokku-letsencrypt leaves this marker beside a cert it installed, which
    // makes the certificate its business rather than the operator's.
    dokku.writeHostFile(`${tls}/server.letsencrypt.crt`, 'marker\n');
    data = await dokku.json('report', APP);
    expect(data.capabilities.find((c: any) => c.key === 'tls')).toBeDefined();
    expect(data.capabilities.find((c: any) => c.key === 'tls-custom-cert')).toBeUndefined();

    dokku.runHostShell(`rm -rf ${tls}`);
  });

  it('renders the classification legend in text mode', async () => {
    const result = await dokku.exec('report', APP);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Current proxy');
    expect(result.stdout).toContain('In use');
    expect(result.stdout).toContain('Portability');
  });
});
