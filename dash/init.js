import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const seedHosts = process.env.DASH_DAPI_SEEDS
  ? process.env.DASH_DAPI_SEEDS.split(',').map((value) => value.trim()).filter(Boolean)
  : ['seed-1.testnet.networks.dash.org:1443', 'seed-2.testnet.networks.dash.org:1443'];

async function checkWallet() {
  try {
    console.log("Connecting to Dash Testnet...");

    if (seedHosts.length === 0) {
      throw new Error('No DASH_DAPI_SEEDS configured.');
    }

    let bestBlockHash;
    let activeSeed;

    for (const seed of seedHosts) {
      try {
        const response = await fetch(`https://${seed}/`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            method: 'getBlockHash',
            id: 1,
            jsonrpc: '2.0',
            params: { height: 100 }
          })
        });

        const payload = await response.json();

        if (payload.error) {
          throw new Error(payload.error.message || 'Seed JSON-RPC error');
        }

        bestBlockHash = payload.result;
        activeSeed = seed;
        break;
      } catch {
        // Try the next configured seed
      }
    }

    if (!bestBlockHash) {
      throw new Error('All configured seed gateways failed JSON-RPC check.');
    }

    console.log("---------------------------------------");
    console.log("✅ SUCCESS!");
    console.log("Seed gateways reachable.");
    console.log("Best block hash:", bestBlockHash);
    console.log("Active seed:", activeSeed);
    console.log("Configured seeds:", seedHosts.join(', '));
    console.log("---------------------------------------");

  } catch (e) {
    console.error('❌ Error:', e.message);
    console.log('Seed gateway check uses JSON-RPC getBlockHash (seed-compatible).');
    console.log('Verify outbound 1443 access or try alternate seed hosts.');
  }
}

checkWallet();