// dashStore.js
import Dash from "dash";

const client = new Dash.Client({
  network: "testnet",
  wallet: {
    mnemonic: process.env.DASH_MNEMONIC,
    unsafeOptions: {
      skipSynchronizationBeforeHeight: 650000,
    },
  },
  apps: {
    bagRegistry: {
      contractId: process.env.DASH_CONTRACT_ID,
    },
  },
});

export async function saveBagToDash(docData) {
  const identity = await client.platform.identities.get(process.env.DASH_IDENTITY_ID);

  const bagDocument = await client.platform.documents.create(
    "bagRegistry.bag",
    identity,
    docData
  );

  await client.platform.documents.broadcast(
    { create: [bagDocument] },
    identity
  );

  return bagDocument.toJSON();
}

export async function listBagsFromDash() {
  const docs = await client.platform.documents.get("bagRegistry.bag", {
    limit: 100,
  });

  return docs.map((d) => d.toJSON());
}