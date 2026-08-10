import { execSync, spawn, spawnSync } from 'child_process';

const DOKKU_HOST = process.env.DOKKU_HOST || 'local';
const DOKKU_SSH_PORT = process.env.DOKKU_SSH_PORT || '22';
const USE_SUDO = process.env.DOKKU_USE_SUDO === 'true';

// CI runs Dokku in a container; set DOKKU_CONTAINER to drive it with
// `docker exec` instead of a local binary or SSH.
const DOKKU_CONTAINER = process.env.DOKKU_CONTAINER || '';

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class DokkuRouter {
  private apps: string[] = [];

  private isRemote(): boolean {
    return DOKKU_HOST !== 'local' && DOKKU_HOST !== 'localhost' && DOKKU_HOST !== '127.0.0.1';
  }

  private buildCommand(args: string[]): string {
    const argsStr = args.join(' ');
    if (DOKKU_CONTAINER) {
      return `docker exec ${DOKKU_CONTAINER} dokku ${argsStr}`;
    }
    if (this.isRemote()) {
      return `ssh -o StrictHostKeyChecking=no -p ${DOKKU_SSH_PORT} dokku@${DOKKU_HOST} ${argsStr}`;
    }
    return USE_SUDO ? `sudo dokku ${argsStr}` : `dokku ${argsStr}`;
  }

  /** Run an arbitrary shell command on whichever host Dokku lives on. */
  private hostShell(inner: string): void {
    if (DOKKU_CONTAINER) {
      spawnSync('docker', ['exec', DOKKU_CONTAINER, 'sh', '-c', inner], { stdio: 'inherit' });
      return;
    }
    if (this.isRemote()) {
      execSync(
        `ssh -o StrictHostKeyChecking=no -p ${DOKKU_SSH_PORT} dokku@${DOKKU_HOST} "${inner}"`
      );
      return;
    }
    execSync(USE_SUDO ? `sudo sh -c '${inner}'` : `sh -c '${inner}'`);
  }

  /**
   * Dokku emits harmless noise on stderr after plugin installs and when the
   * proxy is not reloadable in a test environment. Treat those as success when
   * the command actually produced output.
   */
  private isHarmlessWarning(stderr: string): boolean {
    const lines = stderr.split('\n').filter((l) => l.trim());
    return (
      lines.length > 0 &&
      lines.every(
        (l) =>
          l.includes('main: command not found') ||
          l.includes('Checking nginx status is not possible') ||
          l.trim() === ''
      )
    );
  }

  /** Spawn with inherited stdin; piped stdin breaks Dokku's basher dispatch. */
  private spawnAsync(cmd: string): Promise<ExecResult> {
    return new Promise((resolve) => {
      const parts = cmd.split(/\s+/);
      const child = spawn(parts[0], parts.slice(1), { stdio: ['inherit', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      child.on('close', (code) => {
        const exitCode = code ?? 1;
        if (exitCode === 0 || (stdout.length > 0 && this.isHarmlessWarning(stderr))) {
          resolve({ exitCode: 0, stdout, stderr });
        } else {
          resolve({ exitCode, stdout, stderr });
        }
      });
    });
  }

  private execSyncTolerant(cmd: string): string {
    const parts = cmd.split(/\s+/);
    const result = spawnSync(parts[0], parts.slice(1), {
      encoding: 'utf-8',
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    if (result.status === 0) return result.stdout;
    if (this.isHarmlessWarning(result.stderr || '')) return result.stdout;

    const error: any = new Error(`Command failed: ${cmd}\n${result.stderr}`);
    error.status = result.status;
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }

  /** Run a `dokku router:*` command. */
  async exec(...args: string[]): Promise<ExecResult> {
    const full = args[0]?.startsWith('router') ? args : ['router:' + args[0], ...args.slice(1)];
    return this.spawnAsync(this.buildCommand(full));
  }

  /** Run a `dokku router:*` command and parse its --format json output. */
  async json(...args: string[]): Promise<any> {
    const result = await this.exec(...args, '--format', 'json');
    if (result.exitCode !== 0) {
      throw new Error(`router ${args.join(' ')} failed (${result.exitCode}): ${result.stderr}`);
    }
    return JSON.parse(result.stdout);
  }

  /** Run any dokku command. */
  runDokku(...args: string[]): string {
    return this.execSyncTolerant(this.buildCommand(args));
  }

  async execDokku(...args: string[]): Promise<ExecResult> {
    return this.spawnAsync(this.buildCommand(args));
  }

  createTestApp(name: string): void {
    this.runDokku('apps:create', name);
    this.apps.push(name);
  }

  addDomain(app: string, domain: string): void {
    this.runDokku('domains:add', app, domain);
  }

  setNginxProperty(app: string, key: string, value: string): void {
    this.runDokku('nginx:set', app, key, value);
  }

  setPorts(app: string, ...mappings: string[]): void {
    this.runDokku('ports:set', app, ...mappings);
  }

  /** Write a file onto the Dokku host (used to plant an nginx.conf.sigil). */
  writeHostFile(path: string, contents: string): void {
    const encoded = Buffer.from(contents).toString('base64');
    this.hostShell(`echo ${encoded} | base64 -d > ${path}`);
  }

  removeHostFile(path: string): void {
    try {
      this.hostShell(`rm -f ${path}`);
    } catch {
      // Nothing to remove.
    }
  }

  async cleanup(): Promise<void> {
    for (const app of [...this.apps].reverse()) {
      try {
        this.runDokku('apps:destroy', app, '--force');
      } catch {
        // Already destroyed.
      }
    }
    this.apps = [];
  }
}

/** Every capability the plugin knows about, by key. */
export const CLASSIFICATIONS = ['portable', 'translatable', 'manual', 'unsupported'] as const;
