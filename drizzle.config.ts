import type { Config } from 'drizzle-kit';

export default {
  schema: './src/hub/db/schema.ts',
  out: './src/hub/db/migrations',
  dialect: 'sqlite',
} satisfies Config;
