import { setupDashClient } from "./setupDashClient.mjs";

const { sdk, keyManager } = await setupDashClient({ identityIndex: 0 });

const IDENTITY_ID = keyManager.identityId;

try {
  const identity = await sdk.identities.fetch(IDENTITY_ID);
  console.log("Identity retrieved:");
  console.dir(identity.toJSON(), { depth: null });
} catch (e) {
  console.error("Something went wrong:");
  console.error(e?.message || e);
}