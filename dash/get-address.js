import Dash from 'dash';

const client = new Dash.Client({
  network: 'testnet',
  wallet: {
    mnemonic: 'rescue since proof more share rich profit hen notable better twenty verify',
  },
  dapiAddresses: ['54.202.193.10:3000'],
});

async function registerWithWallet() {
  try {
    // 1. Sync the wallet first (This connects the "Wallet" to the "Identity")
    console.log("Synchronizing wallet...");
    const account = await client.wallet.getAccount();
    
    // Check if you have money to pay for the identity
    const balance = account.getTotalBalance();
    if (balance === 0) {
      throw new Error(`You need DASH to register! Send coins to: ${account.unusedAddress.address}`);
    }

    // 2. Register the Identity using the funds from that wallet
    console.log("Registering Identity using Wallet funds...");
    const identity = await client.platform.identities.register();
    
    console.log("Identity ID Created:", identity.getId().toJSON());
  } catch (e) {
    console.error("Error:", e.message);
  } finally {
    await client.disconnect();
  }
}

registerWithWallet();