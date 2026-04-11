import 'dotenv/config';
import { ethers } from 'ethers';
import { wallet } from '@dashevo/evo-sdk';
import { setupDashClient, clientConfig } from './setupDashClient.mjs';

function bytesToHex(data) {
  if (!Array.isArray(data)) {
    throw new Error('identityKey.data is missing or invalid.');
  }

  return `0x${Buffer.from(data).toString('hex')}`;
}

function getChallengeMessage() {
  return String(
    process.env.AUTH_CHALLENGE_MESSAGE ||
    process.argv.slice(2).join(' ').trim() ||
    ''
  ).trim();
}

async function main() {
  const challengeMessage = getChallengeMessage();
  const identityIndex = Number(process.env.IDENTITY_INDEX || 0);

  if (!challengeMessage) {
    throw new Error('Provide the challenge message via AUTH_CHALLENGE_MESSAGE or as a command-line argument.');
  }

  const { sdk, keyManager } = await setupDashClient({ identityIndex });

  try {
    if (!keyManager) {
      throw new Error('Identity key manager was not initialized. Set PLATFORM_MNEMONIC in .env.');
    }

    const { identity, identityKey } = await keyManager.getAuth();
    const authPublicKeyHex = bytesToHex(identityKey?.toJSON?.().data || []);
    const authKeyAddress = ethers.computeAddress(authPublicKeyHex);
    const signature = await wallet.signMessage(challengeMessage, keyManager.keys.auth.privateKeyWif);

    console.log(JSON.stringify({
      network: clientConfig.network,
      identityIndex,
      identityId: identity?.id?.toString?.() || keyManager.identityId,
      authKeyId: identityKey?.toJSON?.().id ?? null,
      authKeyAddress,
      challengeMessage,
      signature
    }, null, 2));
  } finally {
    if (sdk?.disconnect) {
      await sdk.disconnect();
    }
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});