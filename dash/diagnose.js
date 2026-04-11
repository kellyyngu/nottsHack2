import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Dash from 'dash';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '..', '.env');

dotenv.config({ path: envPath });

const network = process.env.DASH_NETWORK || 'testnet';
const mnemonic = process.env.DASH_MNEMONIC;
const skipSyncBeforeHeight = Number.parseInt(process.env.DASH_SKIP_SYNC_BEFORE_HEIGHT || '650000', 10);
const appName = process.env.DASH_APP_NAME || 'ecoTrace';
const contractId = process.env.DASH_CONTRACT_ID;
const dapiAddresses = process.env.DASH_DAPI_ADDRESSES
  ? process.env.DASH_DAPI_ADDRESSES.split(',').map((value) => value.trim()).filter(Boolean)
  : [];

function maskMnemonic(value) {
  if (!value) return 'missing';
  const words = value.trim().split(/\s+/);
  return `${words.length} words loaded`;
}

async function runDiagnosis() {
  console.log('--- Dash Diagnosis ---');
  console.log('env path:', envPath);
  console.log('network:', network);
  console.log('mnemonic:', maskMnemonic(mnemonic));
  console.log('app name:', appName);
  console.log('skip sync before height:', Number.isFinite(skipSyncBeforeHeight) ? skipSyncBeforeHeight : 'disabled');
  console.log('contract id set:', contractId ? 'yes' : 'no');
  console.log('dapi override:', dapiAddresses.length > 0 ? dapiAddresses.join(', ') : 'none (SDK discovery)');

  if (!mnemonic) {
    throw new Error('DASH_MNEMONIC is missing in .env');
  }

  const apps = {
    dpns: { contractId: 'GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec' }
  };

  if (contractId && contractId.trim().length > 0) {
    apps[appName] = { contractId: contractId.trim() };
  } else {
    console.log('note: DASH_CONTRACT_ID missing/empty; skipping app contract wiring for diagnosis.');
  }

  const clientOptions = {
    network,
    wallet: { mnemonic },
    apps
  };

  if (Number.isFinite(skipSyncBeforeHeight)) {
    clientOptions.wallet.unsafeOptions = {
      skipSynchronizationBeforeHeight: skipSyncBeforeHeight
    };
  }

  if (dapiAddresses.length > 0) {
    clientOptions.dapiAddresses = dapiAddresses;
  }

  try {
    const client = new Dash.Client(clientOptions);
    const account = await client.wallet.getAccount();
    const addressInfo = account.getUnusedAddress();
    const address = addressInfo && addressInfo.address ? addressInfo.address : 'Unavailable';
    const confirmedBalance = typeof account.getConfirmedBalance === 'function'
      ? account.getConfirmedBalance()
      : 0;

    console.log('wallet address:', address);
    console.log('confirmed balance (duffs):', confirmedBalance);

    const identities = account.identities.getIdentityIds();
    console.log('identity count:', identities.length);

    console.log('status: success');
  } catch (error) {
    console.error('status: failed');
    console.error('error:', error.message);

    if (error.message.includes('Identifier must be 32 long')) {
      console.error('hint: DASH_CONTRACT_ID in .env is invalid. It must be a valid Dash Platform identifier.');
    }

    if (error.message.includes('No available addresses') || error.message.includes('Max retries reached')) {
      console.error('hint: DAPI bootstrap failed. Try DASH_DAPI_ADDRESSES with known healthy testnet nodes, or a different network path.');
    }

    process.exitCode = 1;
  }
}

runDiagnosis();