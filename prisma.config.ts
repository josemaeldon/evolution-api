import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: process.env.DATABASE_PROVIDER === 'psql_bouncer' ? 'prisma/psql_bouncer-schema.prisma' : 'prisma/postgresql-schema.prisma',
  migrations: {
    path: process.env.DATABASE_PROVIDER === 'psql_bouncer' ? 'prisma/psql_bouncer-migrations' : 'prisma/postgresql-migrations',
  },
  datasource: {
    url: env('DATABASE_CONNECTION_URI'),
  },
});
