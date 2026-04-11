// import { DataContract } from "@dashevo/evo-sdk";
// import { setupDashClient } from "./setupDashClient.mjs";

// const { sdk, keyManager } = await setupDashClient({ identityIndex: 0 });
// const { identity, identityKey, signer } = await keyManager.getAuth();

// const documentSchemas = {
//   note: {
//     type: "object",
//     properties: {
//       message: {
//         type: "string",
//         position: 0,
//       },
//     },
//     additionalProperties: false,
//   },
// };

// try {
//   console.log("identity.id =", identity?.id?.toString?.());
//   console.log("identityKey =", identityKey);
//   console.log("signer exists =", !!signer);

//   const identityNonce = await sdk.identities.nonce(identity.id.toString());
//   console.log("identityNonce =", identityNonce);

//   const dataContract = new DataContract({
//     ownerId: identity.id,
//     identityNonce: (identityNonce || 0n) + 1n,
//     schemas: documentSchemas,
//     fullValidation: true,
//   });

//   console.log("dataContract created");

//   const publishedContract = await sdk.contracts.publish({
//     dataContract,
//     identityKey,
//     signer,
//   });

//   console.log("Contract registered!");
//   console.log("Contract ID:", publishedContract.toJSON().id);
//   console.log(publishedContract.toJSON());
// } catch (e) {
//   console.error("Full error:");
//   console.error(e);
// }

// import { setupDashClient } from "./setupDashClient.mjs";

// for (let i = 0; i < 10; i++) {
//   try {
//     const { keyManager } = await setupDashClient({ identityIndex: i });
//     console.log("FOUND:", i, keyManager.identityId);
//   } catch (e) {
//     console.log("MISS :", i, e.message);
//   }
// }

import { setupDashClient } from "./setupDashClient.mjs";

const { sdk, keyManager } = await setupDashClient({ identityIndex: 0 });
const { identity } = await keyManager.getAuth();

const definition = {
  note: {
    type: "object",
    properties: {
      message: {
        type: "string",
        position: 0,
      },
    },
    additionalProperties: false,
  },
};

try {
  const ownerId = identity.id.toString();
  const privateKeyWif = keyManager.keys.auth.privateKeyWif;
  const keyId = keyManager.keys.auth.keyId;

  console.log("ownerId =", ownerId);
  console.log("keyId =", keyId);

  const publishedContract = await sdk.contracts.publish({
    ownerId,
    definition,
    privateKeyWif,
    keyId,
  });

  console.log("Contract registered!");
  console.log("Contract ID:", publishedContract.toJSON().id);
  console.log(publishedContract.toJSON());
} catch (e) {
  console.error("Full error:");
  console.error(e);
}