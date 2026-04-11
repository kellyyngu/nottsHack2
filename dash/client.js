import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Dash from 'dash';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const APP_NAME = process.env.DASH_APP_NAME || 'ecoTrace';
const network = process.env.DASH_NETWORK || 'testnet';
const mnemonic = process.env.DASH_MNEMONIC;
const skipSyncBeforeHeight = Number.parseInt(process.env.DASH_SKIP_SYNC_BEFORE_HEIGHT || '650000', 10);
const contractId = process.env.DASH_CONTRACT_ID;
const dapiAddresses = process.env.DASH_DAPI_ADDRESSES
  ? process.env.DASH_DAPI_ADDRESSES.split(',').map((value) => value.trim()).filter(Boolean)
  : [];

if (!mnemonic) {
  throw new Error('Set DASH_MNEMONIC in .env before running dash/client.js');
}

const apps = {
  dpns: {
    contractId: 'GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec',
  }
};

if (contractId && contractId.trim().length > 0) {
  apps[APP_NAME] = { contractId: contractId.trim() };
} else {
  console.log('DASH_CONTRACT_ID missing/empty; starting without ecoTrace app contract.');
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

const client = new Dash.Client(clientOptions);

const connectAndCheck = async () => {
  try {
    const account = await client.wallet.getAccount();
    const unusedAddress = account.getUnusedAddress();
    console.log('Connected. Your address:', unusedAddress && unusedAddress.address ? unusedAddress.address : 'Unavailable');
    if (typeof account.getConfirmedBalance === 'function') {
      console.log('Confirmed balance:', account.getConfirmedBalance());
    }
  } catch (e) {
    console.error('Dash connection failed:', e.message);
    if (e.message.includes('Identifier must be 32 long')) {
      console.error('DASH_CONTRACT_ID is invalid. Use the contract ID printed by registerContract.js.');
    }
    if (e.message.includes('No available addresses') || e.message.includes('Max retries reached')) {
      console.error('If this persists, try a funded/active testnet mnemonic and verify DASH_NETWORK=testnet.');
      console.error('You can also set DASH_DAPI_ADDRESSES explicitly with healthy testnet nodes.');
    }
  } finally {
    await client.disconnect();
  }
};

connectAndCheck();