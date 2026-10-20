// Verifies that the bundled third-party files are byte-identical to their npm releases.
// Run: npm run check:vendor
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const VENDOR = [
  { pkg: 'qr-code-styling@1.9.2', file: 'lib/qr-code-styling.js', local: 'vendor/qr-code-styling/qr-code-styling.js' },
  { pkg: 'jsqr@1.4.0', file: 'dist/jsQR.js', local: 'vendor/jsqr/jsQR.js' },
];

const work = mkdtempSync(path.join(tmpdir(), 'qrcd-vendor-'));
let failed = false;
try {
  for (const v of VENDOR) {
    const tgz = execFileSync('npm', ['pack', v.pkg, '--silent', '--pack-destination', work], { encoding: 'utf8' }).trim().split('\n').pop();
    execFileSync('tar', ['xzf', path.join(work, tgz), '-C', work]);
    const same = readFileSync(path.join(work, 'package', v.file)).equals(readFileSync(v.local));
    console.log(`${same ? 'ok  ' : 'DIFF'} ${v.local} = ${v.pkg}/${v.file}`);
    failed ||= !same;
    rmSync(path.join(work, 'package'), { recursive: true, force: true });
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
