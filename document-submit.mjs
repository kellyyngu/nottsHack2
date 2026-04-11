import { Document } from "@dashevo/evo-sdk";
import { setupDashClient } from "./setupDashClient.mjs";

const { sdk, keyManager } = await setupDashClient({ identityIndex: 0 });
const { identity, identityKey, signer } = await keyManager.getAuth();

// Hardcode the default tutorial contract for now
const DATA_CONTRACT_ID = "FW3DHrQiG24VqzPY4ARenMgjEPpBNuEQTZckV8hbVCG4";

try {
  console.log("identity.id =", identity.id.toString());
  console.log("DATA_CONTRACT_ID =", DATA_CONTRACT_ID);

  const document = new Document({
    properties: {
      message: `Tutorial Test @ ${new Date().toUTCString()}`,
    },
    documentTypeName: "note",
    dataContractId: DATA_CONTRACT_ID,
    ownerId: identity.id,
  });

  await sdk.documents.create({
    document,
    identityKey,
    signer,
  });

  console.log("Document submitted:");
  console.log(document.toJSON());
} catch (e) {
  console.error("message =", e?.message);
  console.error("string =", e?.toString?.());
  console.dir(e, { depth: null });
}