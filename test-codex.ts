import { getCodexRateLimitData } from './src/quotaService';

async function run() {
    console.log("Checking Codex Quota Data...");
    const data = await getCodexRateLimitData();
    console.log(JSON.stringify(data, null, 2));
}

run();
