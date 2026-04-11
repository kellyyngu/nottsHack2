import Dash from "dash";
import { Identifier } from "@dashevo/evo-sdk";
import bs58 from "bs58";

function idFromBase58(id) {
  if (!id || typeof id !== "string") {
    throw new Error("Missing or invalid Dash ID");
  }
  return new Identifier(Buffer.from(bs58.decode(id)));
}

function getDashClient() {
  const mnemonic = process.env.DASH_MNEMONIC;
  if (!mnemonic) {
    throw new Error("DASH_MNEMONIC is missing");
  }

  return new Dash.Client({
    network: "testnet",
    wallet: {
      mnemonic,
      unsafeOptions: {
        skipSynchronizationBeforeHeight: 650000,
      },
    },
    apps: {
      bagRegistry: {
        contractId: idFromBase58(process.env.DASH_CONTRACT_ID),
      },
    },
  });
}

export async function saveBagToDash(docData) {
  const client = getDashClient();
  try {
    const identity = await client.platform.identities.get(
      idFromBase58(process.env.DASH_IDENTITY_ID)
    );

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
  } finally {
    client.disconnect();
  }
}

export async function listBagsFromDash() {
  const client = getDashClient();
  try {
    const docs = await client.platform.documents.get("bagRegistry.bag", {
      limit: 100,
    });

    return docs.map((d) => d.toJSON());
  } finally {
    client.disconnect();
  }
}