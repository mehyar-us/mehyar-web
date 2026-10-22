import {cloudflareTest,readD1Migrations} from '@cloudflare/vitest-plugin';
import {defineConfig} from 'vitest/config';
export default defineConfig(async()=>({plugins:[cloudflareTest({main:"./src/index.ts",
  miniflare:{compatibilityDate:'2026-09-22',compatibilityFlags:['nodejs_compat','global_fetch_strictly_public'],
    durableObjects:{MAYOR_VOICE:{className:'MayorVoice',useSQLite:true}},d1Databases:['AGENT_DB','MIGRATION_TEST_DB'],bindings:{
      TEST_MIGRATIONS:await readD1Migrations('./migrations'),
      APP_ORIGIN:'https://mayor.example.test',ENVIRONMENT:'test',
      BETTER_AUTH_SECRET:'test-only-mayor-secret-not-for-production-000000',
      TOKEN_ENCRYPTION_KEY:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    }}
})],test:{include:['tests/integration/**/*.test.ts'],setupFiles:['tests/integration/setup.ts'],testTimeout:20000}}));
