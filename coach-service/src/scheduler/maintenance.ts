import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/scheduler/maintenance.js → coach-service root is two levels up.
const COACH_ROOT = path.resolve(__dirname, '..', '..');
const BRIDGE_ROOT = path.resolve(COACH_ROOT, '..', 'bridge-api');

/**
 * Weekly dependency security report. Runs `npm audit` in both packages and, if
 * there are HIGH/CRITICAL vulnerabilities, sends a concise Telegram summary so
 * Matt knows to patch. It REPORTS rather than auto-upgrading — blind major
 * upgrades can break a running service. (Auto `npm audit fix` for patch-level
 * fixes could be added later if desired.)
 */
async function auditDir(dir: string): Promise<{ high: number; critical: number } | null> {
  try {
    // npm audit exits non-zero when vulns exist; capture stdout regardless.
    const { stdout } = await execAsync('npm audit --json', {
      cwd: dir,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    }).catch((e: any) => ({ stdout: e?.stdout ?? '' }));
    if (!stdout) return null;
    const data = JSON.parse(stdout);
    const v = data?.metadata?.vulnerabilities ?? {};
    return { high: v.high ?? 0, critical: v.critical ?? 0 };
  } catch (err) {
    logger.warn({ err, dir }, 'npm audit failed (non-fatal)');
    return null;
  }
}

export async function runMaintenanceReport(deliver: (text: string) => Promise<void>): Promise<void> {
  const [coach, bridge] = await Promise.all([auditDir(COACH_ROOT), auditDir(BRIDGE_ROOT)]);
  const lines: string[] = [];
  for (const [label, r] of [
    ['coach-service', coach],
    ['bridge-api', bridge],
  ] as const) {
    if (r && (r.high > 0 || r.critical > 0)) {
      lines.push(`• ${label}: ${r.critical} critical, ${r.high} high`);
    }
  }

  if (lines.length === 0) {
    logger.info('Maintenance: no high/critical vulnerabilities');
    return;
  }

  await deliver(
    `🔧 Weekly maintenance — dependency vulnerabilities found:\n${lines.join('\n')}\n` +
      `Run \`npm audit fix\` in the affected package(s) when convenient.`,
  );
  logger.warn({ lines }, 'Maintenance report sent');
}
