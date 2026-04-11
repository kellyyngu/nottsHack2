import Dash from "dash";

const APP_NAME = process.env.DASH_APP_NAME || "ecoTrace";
const network = process.env.DASH_NETWORK || "testnet";
const mnemonic = process.env.DASH_MNEMONIC;

if (!mnemonic) {
  throw new Error("Set DASH_MNEMONIC in your environment before running registerContract.js");
}

const client = new Dash.Client({
  network,
  wallet: {
    mnemonic
  },
  apps: {
    [APP_NAME]: {
      contractId: ""
    }
  }
});

const registerContract = async () => {
  const account = await client.getWalletAccount();
  const identity = await client.platform.identities.get(account.identities.getIdentityIds()[0]);

  const contractDefinitions = {
    bid: {
      indices: [ { properties: [{ '$ownerId': 'asc' }, { 'auctionId': 'asc' }] } ],
      properties: {
        auctionId: { type: 'string' },
        amount: { type: 'number', minimum: 0 },
        bidderName: { type: 'string', minLength: 1 },
        timestamp: { type: 'number' }
      },
      required: ['auctionId', 'amount', 'bidderName', 'timestamp'],
      additionalProperties: false
    },
    comment: {
      indices: [ { properties: [{ '$ownerId': 'asc' }, { 'tokenId': 'asc' }] } ],
      properties: {
        tokenId: { type: 'number', minimum: 0 },
        commenterName: { type: 'string', minLength: 1 },
        message: { type: 'string', minLength: 1, maxLength: 1000 },
        timestamp: { type: 'number' }
      },
      required: ['tokenId', 'commenterName', 'message', 'timestamp'],
      additionalProperties: false
    }
  };

  try {
    const contract = await client.platform.contracts.create(contractDefinitions, identity);
    console.log('Registering contract...');
    await client.platform.contracts.broadcast({ create: [contract] }, identity);
    
    console.log('✅ Contract Registered! ID:', contract.getId().toString());
    // Copy this ID and save it in .env file
  } catch (e) {
    console.error('Error registering contract:', e);
  } finally {
    client.disconnect();
  }
};

registerContract();