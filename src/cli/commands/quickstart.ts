// 5-minute introduction. Verifier-only build: walk the caller through
// analyze → gap on a real project. No demo orchestration any more.
export async function quickstart(flags: Record<string, string | boolean>): Promise<number> {
  const project = typeof flags.project === 'string' ? flags.project : '<path/to/your/project>';
  process.stdout.write(
    [
      'MatrixOmnix verifier — quickstart',
      '',
      `1. Detect the project's archetype:`,
      `   matrixomnix archetype --project ${project}`,
      '',
      `2. Get a gap report with evidence verification:`,
      `   matrixomnix gap --project ${project}`,
      '',
      `3. Or run the MCP server (stdio transport) so an agent client can call it:`,
      `   node dist/mcp/server.js`,
      `   # or once published:  npx d2p-verify`,
      '',
      'MatrixOmnix is read-only. To produce changes, use a do-layer (d2p,',
      'Claude Code, Cursor, custom) and re-run gap / verify afterwards.',
      '',
    ].join('\n'),
  );
  return 0;
}
