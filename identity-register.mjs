import { randomBytes } from "node:crypto";
import { Identity, Identifier } from "@dashevo/evo-sdk";
import { setupDashClient } from "./setupDashClient.mjs";

console.log("NETWORK =", process.env.NETWORK);
console.log("PLATFORM_MNEMONIC exists =", !!process.env.PLATFORM_MNEMONIC);

const { sdk, keyManager, addressKeyManager } = await setupDashClient({
  requireIdentity: false,
});

try {
  const identity = new Identity(new Identifier(randomBytes(32)));

  keyManager.getKeysInCreation().forEach((key) => {
    identity.addPublicKey(key.toIdentityPublicKey());
  });

  const result = await sdk.addresses.createIdentity({
    identity,
    inputs: [
      {
        address: addressKeyManager.primaryAddress.bech32m,
        amount: 5000000n,
      },
    ],
    identitySigner: keyManager.getFullSigner(),
    addressSigner: addressKeyManager.getSigner(),
  });

  console.log("Identity registered!");
  console.log("Identity ID:", result.identity.id.toString());
} catch (e) {
  console.error("Full error:");
  console.error(e?.stack || e);
}