import { defineConfig } from '@playwright/test';
const port=Number(process.env.PLAYWRIGHT_PORT||5173),url=`http://127.0.0.1:${port}`;
export default defineConfig({testDir:'./e2e',fullyParallel:false,workers:1,reporter:'list',use:{baseURL:url,viewport:{width:1440,height:1000},channel:process.env.PLAYWRIGHT_CHANNEL||undefined,launchOptions:{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined}},webServer:{command:`npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,url,reuseExistingServer:!process.env.CI},outputDir:'test-results'});
