import Dash from "dash";
import dotenv from "dotenv";
import dns from "node:dns/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const network = process.env.DASH_NETWORK || "testnet";
const mnemonic = process.env.DASH_MNEMONIC;
const identityIdFromEnv = process.env.DASH_IDENTITY_ID;
const grpcTimeoutMs = Number.parseInt(process.env.DASH_GRPC_TIMEOUT_MS || "30000", 10);
const skipSyncBeforeHeight = Number.parseInt(process.env.DASH_SKIP_SYNC_BEFORE_HEIGHT || "650000", 10);
const seedHosts = process.env.DASH_DAPI_SEEDS
  ? process.env.DASH_DAPI_SEEDS.split(",").map((value) => value.trim()).filter(Boolean)
  : [];
const dapiAddresses = process.env.DASH_DAPI_ADDRESSES
  ? process.env.DASH_DAPI_ADDRESSES.split(",").map((value) => value.trim()).filter(Boolean)
  : (network === "testnet"
      ? [
          "186.222.232.129.reverse.xneelo.net:3000",
          "129.232.222.186:3000",
          "44.242.112.52:3000"
        ]
      : []);

if (!mnemonic) {
  throw new Error("Set DASH_MNEMONIC in your environment before running registerContract.js");
}

const clientOptions = {
  network,
  timeout: Number.isFinite(grpcTimeoutMs) ? grpcTimeoutMs : 30000,
  wallet: {
    mnemonic,
    unsafeOptions: Number.isFinite(skipSyncBeforeHeight) ? {
      skipSynchronizationBeforeHeight: skipSyncBeforeHeight
    } : undefined
  }
};

if (dapiAddresses.length === 0) {
  throw new Error("Set DASH_DAPI_ADDRESSES for contract publish (direct DAPI nodes required).");
}

const normalizeDapiAddress = async (entry) => {
  const cleaned = entry.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const [host, port = "3000"] = cleaned.split(":");

  if (!host || !port) {
    return cleaned;
  }

  if (!net.isIP(host)) {
    return `${host}:${port}`;
  }

  try {
    const hostnames = await dns.reverse(host);
    if (hostnames.length > 0) {
      return `${hostnames[0]}:${port}`;
    }
  } catch {
    // Keep original IP if PTR lookup fails
  }

  return `${host}:${port}`;
};

const normalizedDapiAddresses = [];
for (const address of dapiAddresses) {
  const normalized = await normalizeDapiAddress(address);
  if (!normalizedDapiAddresses.includes(normalized)) {
    normalizedDapiAddresses.push(normalized);
  }
}

console.log("Direct DAPI addresses:", normalizedDapiAddresses.join(", "));

clientOptions.dapiAddresses = normalizedDapiAddresses;

const client = new Dash.Client(clientOptions);

const preflightSeeds = async () => {
  if (seedHosts.length === 0) {
    console.log("Preflight: DASH_DAPI_SEEDS not set, skipping seed gateway check.");
    return;
  }

  let activeSeed;
  let bestBlockHash;

  for (const seed of seedHosts) {
    try {
      const response = await fetch(`https://${seed}/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          method: "getBlockHash",
          id: 1,
          jsonrpc: "2.0",
          params: { height: 100 }
        })
      });

      const payload = await response.json();
      if (payload.error) {
        throw new Error(payload.error.message || "Seed JSON-RPC error");
      }

      activeSeed = seed;
      bestBlockHash = payload.result;
      break;
    } catch {
      // Try next configured seed
    }
  }

  if (!activeSeed) {
    throw new Error("Preflight failed: none of DASH_DAPI_SEEDS responded to JSON-RPC getBlockHash.");
  }

  console.log(`Preflight OK via seed ${activeSeed}; block hash ${bestBlockHash}`);
};

async function runStage(stageName, stageFn) {
  console.log(`--- ${stageName} started ---`);
  const result = await stageFn();
  console.log(`--- ${stageName} completed ---`);
  return result;
}

const registerContract = async () => {
  try {
    console.log(`Using gRPC timeout: ${Number.isFinite(grpcTimeoutMs) ? grpcTimeoutMs : 30000}ms`);
    await runStage('Seed preflight', preflightSeeds);

    let identity;

    if (identityIdFromEnv && identityIdFromEnv.trim().length > 0) {
      identity = await runStage('Identity lookup by DASH_IDENTITY_ID', async () => {
        return client.platform.identities.get(identityIdFromEnv.trim());
      });
      if (!identity) {
        throw new Error("DASH_IDENTITY_ID was provided but could not be resolved on the network.");
      }
      console.log("Using identity from DASH_IDENTITY_ID.");
    } else {
      const account = await runStage('Wallet account sync', async () => {
        return client.wallet.getAccount();
      });
      const identityIds = account.identities.getIdentityIds();

      if (!identityIds || identityIds.length === 0) {
        throw new Error("No identity found for this mnemonic. Register an identity first, or set DASH_IDENTITY_ID in .env.");
      }

      identity = await runStage('Identity lookup from wallet account', async () => {
        return client.platform.identities.get(identityIds[0]);
      });
    }

    const contractDefinitions = {
      bid: {
        type: 'object',
        indices: [
          {
            name: 'ownerId',
            properties: [{ '$ownerId': 'asc' }],
            unique: false
          }
        ],
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
        type: 'object',
        indices: [
          {
            name: 'ownerId',
            properties: [{ '$ownerId': 'asc' }],
            unique: false
          }
        ],
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

    const contract = await runStage('Contract create', async () => {
      return client.platform.contracts.create(contractDefinitions, identity);
    });
    console.log('Registering contract...');
    await runStage('Contract publish', async () => {
      return client.platform.contracts.publish(contract, identity);
    });
    
    console.log('✅ Contract Registered! ID:', contract.getId().toString());
    // Copy this ID and save it in .env file
  } catch (e) {
    console.error('Error registering contract:', e);
    if (e && e.stack) {
      console.error('Stack:', e.stack);
    }
    if (e && typeof e.message === "string" && e.message.includes("Preflight failed")) {
      console.error("Tip: Fix DASH_DAPI_SEEDS or outbound 1443 before retrying.");
    }
    if (e && typeof e.message === "string" && e.message.includes("UNIMPLEMENTED")) {
      console.error("Tip: The selected DAPI endpoint does not implement required Core gRPC methods. Use direct DAPI node addresses (host:3000), not seed:1443.");
    }
    if (e && typeof e.message === "string" && e.message.includes("Method not found")) {
      console.error("Tip: This usually means seed-based discovery hit an incompatible endpoint; prefer DASH_DAPI_ADDRESSES for testnet.");
    }
    if (e && typeof e.message === "string" && e.message.includes("No available addresses")) {
      console.error("Tip: Set DASH_IDENTITY_ID in .env to bypass wallet account sync when testnet DAPI discovery is unstable.");
      console.error("Tip: Set DASH_DAPI_ADDRESSES with known healthy testnet nodes, separated by commas.");
    }
  } finally {
    await client.disconnect();
  }
};

registerContract();