// Minimal environment + config diagnose for the verifier-only build.
export async function doctor(_flags: Record<string, string | boolean>): Promise<number> {
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

  checks.push({
    name: 'node >= 20',
    ok: parseInt(process.versions.node.split('.')[0]!, 10) >= 20,
    detail: process.versions.node,
  });

  const cwd = process.cwd();
  let hasPackageJson = false;
  try {
    const fs = await import('node:fs/promises');
    await fs.access(`${cwd}/package.json`);
    hasPackageJson = true;
  } catch {
    hasPackageJson = false;
  }
  checks.push({ name: 'package.json in cwd', ok: hasPackageJson });

  const allOk = checks.every((c) => c.ok);
  process.stdout.write(JSON.stringify({ ok: allOk, checks }, null, 2) + '\n');
  return allOk ? 0 : 2;
}
