import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async()=>({
  plugins:[cloudflareTest({
    wrangler:{configPath:'./wrangler.jsonc'},
    miniflare:{bindings:{
      TEST_MIGRATIONS:await readD1Migrations('./migrations'),
      BETTER_AUTH_SECRET:'test-only-secret-not-for-deployment-000000000000000000',
      TOKEN_ENCRYPTION_KEY:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    }},
  })],
  test:{setupFiles:['./tests/setup.ts'],testTimeout:20_000},
}));
