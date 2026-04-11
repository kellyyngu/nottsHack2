import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Dash from 'dash';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const network = process.env.DASH_NETWORK || 'testnet';
const identityId = process.env.DASH_IDENTITY_ID;
const mnemonic = process.env.DASH_MNEMONIC;
const grpcTimeoutMs = Number.parseInt(process.env.DASH_GRPC_TIMEOUT_MS || '30000', 10);
const dapiAddresses = process.env.DASH_DAPI_ADDRESSES
  ? process.env.DASH_DAPI_ADDRESSES.split(',').map((value) => value.trim()).filter(Boolean)
  : [];

if (!identityId) {
  throw new Error('Set DASH_IDENTITY_ID in .env before running grpc-read-test.js');
}

if (dapiAddresses.length === 0) {
  throw new Error('Set DASH_DAPI_ADDRESSES in .env before running grpc-read-test.js');
}

const client = new Dash.Client({
  network,
  dapiAddresses,
  timeout: Number.isFinite(grpcTimeoutMs) ? grpcTimeoutMs : 30000,
  wallet: mnemonic ? { mnemonic } : undefined,
});

const run = async () => {
  try {
    console.log('--- gRPC read test started ---');
    console.log('Network:', network);
    console.log('Direct DAPI addresses:', dapiAddresses.join(', '));
    console.log('gRPC timeout (ms):', Number.isFinite(grpcTimeoutMs) ? grpcTimeoutMs : 30000);
    console.log('Identity ID:', identityId);

    const identity = await client.platform.identities.get(identityId);

    if (!identity) {
      throw new Error('Identity lookup returned empty result.');
    }

    console.log('✅ gRPC read success: identity resolved.');
    if (typeof identity.toJSON === 'function') {
      const json = identity.toJSON();
      console.log('Identity id:', json.id || identityId);
      console.log('Public keys count:', Array.isArray(json.publicKeys) ? json.publicKeys.length : 'unknown');
    }
    console.log('--- gRPC read test completed ---');
  } catch (e) {
    console.error('❌ gRPC read failed:', e.message);
    if (e && e.stack) {
      console.error('Stack:', e.stack);
    }
    if (e && typeof e.message === 'string' && e.message.includes('DEADLINE_EXCEEDED')) {
      console.error('Hint: direct DAPI endpoint is reachable but not serving request in time.');
    }
    if (e && typeof e.message === 'string' && e.message.includes('No available addresses')) {
      console.error('Hint: none of the configured direct DAPI nodes were usable.');
    }
    if (e && typeof e.message === 'string' && e.message.includes('UNIMPLEMENTED')) {
      console.error('Hint: endpoint does not support required method for this client path.');
    }
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
};

run();
