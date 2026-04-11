import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const seedHosts = process.env.DASH_DAPI_SEEDS
  ? process.env.DASH_DAPI_SEEDS.split(',').map((value) => value.trim()).filter(Boolean)
  : ['seed-1.testnet.networks.dash.org:1443', 'seed-2.testnet.networks.dash.org:1443'];

const directHosts = process.env.DASH_DAPI_ADDRESSES
  ? process.env.DASH_DAPI_ADDRESSES.split(',').map((value) => value.trim()).filter(Boolean)
  : ['54.149.33.167:3000', '129.232.222.186:3000', '44.242.112.52:3000'];

function parseHostPort(entry, defaultPort) {
  const cleaned = entry.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const [host, portValue] = cleaned.split(':');
  const port = Number.parseInt(portValue || String(defaultPort), 10);
  return { host, port };
}

function testTcp(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (result) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(result);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish({ ok: true }));
    socket.on('timeout', () => finish({ ok: false, error: `timeout after ${timeoutMs}ms` }));
    socket.on('error', (error) => finish({ ok: false, error: error.message }));
  });
}

async function testSeedGateway(seed) {
  const { host, port } = parseHostPort(seed, 1443);
  const url = `https://${host}:${port}/`;

  try {
    const response = await fetch(url, {
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
      return { target: `${host}:${port}`, ok: false, error: payload.error.message || 'JSON-RPC error' };
    }

    return { target: `${host}:${port}`, ok: true, detail: payload.result };
  } catch (error) {
    return { target: `${host}:${port}`, ok: false, error: error.message };
  }
}

async function main() {
  console.log('Seed gateway checks (JSON-RPC getBlockHash):');
  for (const seed of seedHosts) {
    const result = await testSeedGateway(seed);
    console.log(`- ${result.target}: ${result.ok ? 'ok' : `fail (${result.error})`}${result.detail ? ` [${result.detail}]` : ''}`);
  }

  console.log('\nDirect DAPI checks (TCP only):');
  for (const entry of directHosts) {
    const { host, port } = parseHostPort(entry, 3000);
    const result = await testTcp(host, port);
    console.log(`- ${host}:${port}: ${result.ok ? 'open' : `blocked (${result.error})`}`);
  }
}

main().catch((error) => {
  console.error('Network check failed:', error.message);
  process.exitCode = 1;
});
