import 'dotenv/config';
import { ethers } from 'ethers';
import { setupDashClient, clientConfig } from './setupDashClient.mjs';

function bytesToHex(data) {
  if (!Array.isArray(data)) {
    throw new Error('identityKey.data is missing or invalid.');
  }
  return `0x${Buffer.from(data).toString('hex')}`;
}

async function main() {
  const identityIndex = Number(process.env.IDENTITY_INDEX || 0);
  const expectedPlatformAddress = String(process.env.PLATFORM_ADDRESS || '').trim();
  const expectedAuthAddress = String(
    process.env.AUTH_KEY_ADDRESS || process.env.AUTH_ADDRESS || process.env.DEVELOPER_ADDRESS || ''
  ).trim();

  const { sdk, keyManager, addressKeyManager } = await setupDashClient({ identityIndex });

  try {
    if (!keyManager) {
      throw new Error('Identity key manager was not initialized. Set PLATFORM_MNEMONIC in .env.');
    }

    const { identity, identityKey } = await keyManager.getAuth();
    const authPublicKeyHex = bytesToHex(identityKey?.toJSON?.().data || []);
    const authKeyAddress = ethers.computeAddress(authPublicKeyHex);

    const derivedPlatformAddress = String(addressKeyManager?.primaryAddress?.bech32m || '');
    const normalizedExpectedAuth = expectedAuthAddress ? ethers.getAddress(expectedAuthAddress) : '';

    const result = {
      network: clientConfig.network,
      identityIndex,
      identityId: identity?.id?.toString?.() || keyManager.identityId,
      authKeyId: identityKey?.toJSON?.().id ?? null,
      authPublicKeyHex,
      authKeyAddress,
      derivedPlatformAddress,
      expectedPlatformAddress: expectedPlatformAddress || null,
      expectedAuthAddress: normalizedExpectedAuth || null,
      platformAddressMatches: expectedPlatformAddress
        ? derivedPlatformAddress.toLowerCase() === expectedPlatformAddress.toLowerCase()
        : null,
      authAddressMatches: normalizedExpectedAuth
        ? authKeyAddress.toLowerCase() === normalizedExpectedAuth.toLowerCase()
        : null
    };

    console.log(JSON.stringify(result, null, 2));

    if (
      (result.platformAddressMatches === false) ||
      (result.authAddressMatches === false)
    ) {
      process.exitCode = 2;
    }
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
