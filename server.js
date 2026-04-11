import express from "express";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ethers } from "ethers";
import dotenv from "dotenv";
import { mintLuxuryPassport } from "./mint.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DASH_NETWORK = (process.env.DASH_NETWORK || "testnet").toLowerCase();
const DASH_MERCHANT_ADDRESS = process.env.DASH_MERCHANT_ADDRESS || "";
const DASH_MIN_PAYMENT = Number(process.env.DASH_MIN_PAYMENT || "0");
const DASH_EXPLORER_BASE_URL =
  process.env.DASH_EXPLORER_BASE_URL ||
  (DASH_NETWORK === "mainnet" ? "https://api.blockchair.com/dash" : "https://api.blockchair.com/dash/testnet");
const ACCOUNT_FILE = path.join(process.cwd(), "data", "accounts.json");
const ACCOUNT_CHALLENGE_TTL_MS = 10 * 60 * 1000;

const accountChallenges = new Map();

app.use(express.json({ limit: "10mb" }));
app.use(express.static("."));

// Return JSON on body parse errors (invalid JSON) instead of HTML error page
app.use((err, req, res, next) => {
  // body-parser JSON errors come through here; normalize to JSON response
  if (err) {
    const isPayloadTooLarge = err.type === "entity.too.large" || err.status === 413;
    const isBadJson = err.type === 'entity.parse.failed' ||
      err instanceof SyntaxError ||
      (err.status === 400 && typeof err.message === 'string' && err.message.toLowerCase().includes('json'));

    if (isPayloadTooLarge) {
      return res.status(413).json({
        success: false,
        error: "Image payload too large. Capture a smaller image and try again."
      });
    }

    if (isBadJson) {
      return res.status(400).json({ success: false, error: 'Invalid JSON body' });
    }
  }
  next(err);
});

function getConfig(requirePrivateKey = true) {
  const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const privateKey = process.env.PRIVATE_KEY;

  if (!contractAddress) {
    throw new Error("Set CONTRACT_ADDRESS environment variable.");
  }

  if (requirePrivateKey && !privateKey) {
    throw new Error("Set PRIVATE_KEY environment variable.");
  }

  return { rpcUrl, contractAddress, privateKey };
}

function isValidDashTxid(txid) {
  return typeof txid === "string" && /^[a-fA-F0-9]{64}$/.test(txid.trim());
}

function normalizeEthAddress(address) {
  if (typeof address !== "string") {
    return "";
  }

  const trimmed = address.trim();
  if (!trimmed) {
    return "";
  }

  try {
    return ethers.getAddress(trimmed);
  } catch {
    return "";
  }
}

function normalizeDashAddress(address) {
  return typeof address === "string" ? address.trim() : "";
}

function buildChallengeMessage({ purpose, walletAddress, merchantAddress, challengeId, nonce, expiresAt }) {
  return [
    "#BAG wallet authorization",
    `Purpose: ${purpose}`,
    `Wallet: ${walletAddress}`,
    `Merchant address: ${merchantAddress || "(not provided)"}`,
    `Challenge ID: ${challengeId}`,
    `Nonce: ${nonce}`,
    `Expires: ${new Date(expiresAt).toISOString()}`,
    "Network: Sepolia"
  ].join("\n");
}

async function loadAccounts() {
  try {
    const raw = await readFile(ACCOUNT_FILE, "utf8");
    const payload = JSON.parse(raw);

    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return payload;
    }
  } catch (err) {
    if (!err || err.code !== "ENOENT") {
      throw err;
    }
  }

  return {};
}

async function saveAccounts(accounts) {
  await mkdir(path.dirname(ACCOUNT_FILE), { recursive: true });
  await writeFile(ACCOUNT_FILE, `${JSON.stringify(accounts, null, 2)}\n`, "utf8");
}

function pruneExpiredChallenges() {
  const now = Date.now();
  for (const [challengeId, challenge] of accountChallenges.entries()) {
    if (!challenge || challenge.expiresAt <= now) {
      accountChallenges.delete(challengeId);
    }
  }
}

function createAccountChallenge({ purpose, address, merchantAddress }) {
  const walletAddress = normalizeEthAddress(address);
  if (!walletAddress) {
    throw new Error("A valid Sepolia wallet address is required.");
  }

  const normalizedMerchantAddress = normalizeDashAddress(merchantAddress);
  if ((purpose === "register" || purpose === "update") && !normalizedMerchantAddress) {
    throw new Error("A Dash merchant address is required.");
  }

  const challengeId = randomUUID();
  const nonce = randomUUID().replace(/-/g, "");
  const expiresAt = Date.now() + ACCOUNT_CHALLENGE_TTL_MS;
  const message = buildChallengeMessage({
    purpose,
    walletAddress,
    merchantAddress: normalizedMerchantAddress,
    challengeId,
    nonce,
    expiresAt
  });

  accountChallenges.set(challengeId, {
    challengeId,
    purpose,
    walletAddress,
    merchantAddress: normalizedMerchantAddress,
    nonce,
    message,
    expiresAt
  });

  return {
    challengeId,
    message,
    expiresAt,
    walletAddress,
    merchantAddress: normalizedMerchantAddress
  };
}

function consumeAccountChallenge(challengeId) {
  pruneExpiredChallenges();

  const challenge = accountChallenges.get(challengeId);
  if (!challenge) {
    throw new Error("Challenge expired. Please request a new wallet signature.");
  }

  accountChallenges.delete(challengeId);
  return challenge;
}

async function getAccountByAddress(address) {
  const accounts = await loadAccounts();
  const walletAddress = normalizeEthAddress(address);

  if (!walletAddress) {
    return null;
  }

  return accounts[walletAddress.toLowerCase()] || null;
}

async function upsertAccount({ walletAddress, merchantAddress, createdAt, lastSignedInAt }) {
  const accounts = await loadAccounts();
  const normalizedWalletAddress = normalizeEthAddress(walletAddress);
  if (!normalizedWalletAddress) {
    throw new Error("A valid wallet address is required.");
  }

  const normalizedMerchantAddress = normalizeDashAddress(merchantAddress);
  const now = new Date().toISOString();
  const existing = accounts[normalizedWalletAddress.toLowerCase()] || null;

  const account = {
    walletAddress: normalizedWalletAddress,
    merchantAddress: normalizedMerchantAddress,
    network: "sepolia",
    payoutNetwork: "dash",
    createdAt: existing?.createdAt || createdAt || now,
    updatedAt: now,
    lastSignedInAt: lastSignedInAt || now
  };

  accounts[normalizedWalletAddress.toLowerCase()] = account;
  await saveAccounts(accounts);
  return account;
}

app.get("/auth/account/:address", async (req, res) => {
  try {
    const account = await getAccountByAddress(req.params.address);

    if (!account) {
      return res.status(404).json({ success: false, error: "Account not found." });
    }

    return res.json({ success: true, account });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

app.post("/auth/challenge", (req, res) => {
  try {
    const purpose = String(req.body?.purpose || "register").toLowerCase();
    const address = req.body?.address;
    const merchantAddress = req.body?.merchantAddress;

    if (!["register", "signin", "update"].includes(purpose)) {
      return res.status(400).json({ success: false, error: "Invalid auth purpose." });
    }

    const challenge = createAccountChallenge({ purpose, address, merchantAddress });
    return res.json({ success: true, ...challenge });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message || String(err) });
  }
});

app.post("/auth/register", async (req, res) => {
  try {
    const challengeId = String(req.body?.challengeId || "").trim();
    const address = req.body?.address;
    const merchantAddress = req.body?.merchantAddress;
    const signature = String(req.body?.signature || "").trim();

    if (!challengeId || !signature) {
      return res.status(400).json({ success: false, error: "challengeId and signature are required." });
    }

    const challenge = consumeAccountChallenge(challengeId);
    const walletAddress = normalizeEthAddress(address);
    const normalizedMerchantAddress = normalizeDashAddress(merchantAddress);

    if (!walletAddress || walletAddress.toLowerCase() !== challenge.walletAddress.toLowerCase()) {
      return res.status(400).json({ success: false, error: "Wallet address does not match the challenge." });
    }

    if (!normalizedMerchantAddress) {
      return res.status(400).json({ success: false, error: "Dash merchant address is required." });
    }

    const recoveredAddress = normalizeEthAddress(ethers.verifyMessage(challenge.message, signature));
    if (!recoveredAddress || recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return res.status(401).json({ success: false, error: "Signature verification failed." });
    }

    const account = await upsertAccount({
      walletAddress,
      merchantAddress: normalizedMerchantAddress
    });

    return res.json({ success: true, status: challenge.purpose === "update" ? "updated" : "created", account });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message || String(err) });
  }
});

app.post("/auth/sign-in", async (req, res) => {
  try {
    const challengeId = String(req.body?.challengeId || "").trim();
    const address = req.body?.address;
    const signature = String(req.body?.signature || "").trim();

    if (!challengeId || !signature) {
      return res.status(400).json({ success: false, error: "challengeId and signature are required." });
    }

    const challenge = consumeAccountChallenge(challengeId);
    const walletAddress = normalizeEthAddress(address);

    if (!walletAddress || walletAddress.toLowerCase() !== challenge.walletAddress.toLowerCase()) {
      return res.status(400).json({ success: false, error: "Wallet address does not match the challenge." });
    }

    const recoveredAddress = normalizeEthAddress(ethers.verifyMessage(challenge.message, signature));
    if (!recoveredAddress || recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return res.status(401).json({ success: false, error: "Signature verification failed." });
    }

    const existingAccount = await getAccountByAddress(walletAddress);
    if (!existingAccount) {
      return res.status(404).json({ success: false, error: "No account found for this wallet. Create one first." });
    }

    const account = await upsertAccount({
      walletAddress,
      merchantAddress: existingAccount.merchantAddress,
      createdAt: existingAccount.createdAt,
      lastSignedInAt: new Date().toISOString()
    });

    return res.json({ success: true, status: "signed-in", account });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message || String(err) });
  }
});

async function getDashPaymentSummary(txid) {
  const normalizedTxid = txid.trim();
  const url = `${DASH_EXPLORER_BASE_URL}/dashboards/transaction/${normalizedTxid}`;
  const response = await fetch(url, { headers: { accept: "application/json" } });

  if (!response.ok) {
    throw new Error(`Dash explorer request failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  const txData = payload?.data?.[normalizedTxid] || payload?.data?.[normalizedTxid.toLowerCase()] || payload?.data?.[normalizedTxid.toUpperCase()];

  if (!txData) {
    throw new Error("Dash transaction not found on explorer.");
  }

  const outputs = Array.isArray(txData.outputs) ? txData.outputs : [];
  const receivedSatoshis = outputs
    .filter((output) => {
      const recipient = String(output?.recipient || output?.recipient_address || "");
      return recipient === DASH_MERCHANT_ADDRESS;
    })
    .reduce((sum, output) => sum + Number(output?.value || 0), 0);

  const receivedDash = receivedSatoshis / 1e8;
  const confirmations = Number(txData.transaction?.confirmations || 0);

  return {
    txid: normalizedTxid,
    receivedDash,
    confirmations,
    meetsMinimum: receivedDash >= DASH_MIN_PAYMENT,
    merchantAddress: DASH_MERCHANT_ADDRESS
  };
}

app.get("/dash/payment-info", (_req, res) => {
  if (!DASH_MERCHANT_ADDRESS) {
    return res.status(500).json({
      success: false,
      error: "Set DASH_MERCHANT_ADDRESS in environment before accepting payments."
    });
  }

  return res.json({
    success: true,
    network: DASH_NETWORK,
    merchantAddress: DASH_MERCHANT_ADDRESS,
    minimumDash: DASH_MIN_PAYMENT,
    explorerTxPrefix: DASH_NETWORK === "mainnet"
      ? "https://blockchair.com/dash/transaction/"
      : "https://blockchair.com/dash/testnet/transaction/"
  });
});

app.post("/dash/verify-payment", async (req, res) => {
  try {
    if (!DASH_MERCHANT_ADDRESS) {
      return res.status(500).json({
        success: false,
        error: "Set DASH_MERCHANT_ADDRESS in environment before verifying payments."
      });
    }

    const txid = String(req.body?.txid || "").trim();
    if (!isValidDashTxid(txid)) {
      return res.status(400).json({ success: false, error: "Invalid Dash txid format." });
    }

    const summary = await getDashPaymentSummary(txid);
    return res.json({ success: true, ...summary });
  } catch (err) {
    return res.status(502).json({ success: false, error: err.message || String(err) });
  }
});

app.post("/upload-image", async (req, res) => {
  try {
    const { imageData } = req.body;

    if (!imageData || typeof imageData !== "string") {
      return res.status(400).json({ success: false, error: "imageData is required." });
    }

    const match = imageData.match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/i);
    if (!match) {
      return res.status(400).json({ success: false, error: "Unsupported image format." });
    }

    const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
    const buffer = Buffer.from(match[2], "base64");

    if (buffer.length > 1024 * 1024) {
      return res.status(413).json({ success: false, error: "Image too large. Please retake with lower quality." });
    }

    const uploadsDir = path.join(process.cwd(), "uploads");
    await mkdir(uploadsDir, { recursive: true });

    const fileName = `${Date.now()}-${randomUUID()}.${ext}`;
    const filePath = path.join(uploadsDir, fileName);
    await writeFile(filePath, buffer);

    return res.json({ success: true, imageURI: `/uploads/${fileName}` });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

app.post("/mint", async (req, res) => {
  try {
    const { bagName, condition, material, imageURI, dashTxId } = req.body;

    if (!bagName || !condition || !material || !imageURI || !dashTxId) {
      return res.status(400).json({ error: "bagName, condition, material, imageURI and dashTxId are required." });
    }

    if (!DASH_MERCHANT_ADDRESS) {
      return res.status(500).json({ success: false, error: "Set DASH_MERCHANT_ADDRESS before minting with payments." });
    }

    if (!isValidDashTxid(dashTxId)) {
      return res.status(400).json({ success: false, error: "Invalid Dash txid format." });
    }

    const payment = await getDashPaymentSummary(dashTxId);
    if (!payment.meetsMinimum) {
      return res.status(400).json({
        success: false,
        error: `Dash payment below minimum. Received ${payment.receivedDash} DASH, require at least ${DASH_MIN_PAYMENT} DASH.`
      });
    }

    const { rpcUrl, contractAddress, privateKey } = getConfig(true);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(privateKey, provider);

    const result = await mintLuxuryPassport({
      contractAddress,
      signer,
      to: await signer.getAddress(),
      bagName,
      condition,
      material,
      imageURI,
      dashTxId
    });

    // Decode ERC-721 Transfer log to return minted tokenId in API response.
    let tokenId = null;
    try {
      const iface = new ethers.Interface([
        "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
      ]);
      for (const log of result.receipt?.logs || []) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed && parsed.name === "Transfer") {
            tokenId = parsed.args.tokenId.toString();
            break;
          }
        } catch {
          // Ignore logs from other contracts/events.
        }
      }
    } catch {
      tokenId = null;
    }

    return res.json({
      success: true,
      txHash: result.hash,
      dashTxId,
      tokenId,
      blockNumber: result.receipt?.blockNumber ?? null
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || String(err)
    });
  }
});

app.get("/read", async (req, res) => {
  try {
    const tokenIdRaw = req.query.tokenId;
    const tokenId = Number(tokenIdRaw);

    if (!Number.isInteger(tokenId) || tokenId < 0) {
      return res.status(400).json({
        success: false,
        error: "tokenId must be a non-negative integer. Example: /read?tokenId=0"
      });
    }

    const { rpcUrl, contractAddress } = getConfig(false);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const ABI = [
      "function ownerOf(uint256 tokenId) view returns (address)",
      "function getBagMetadata(uint256) view returns (tuple(string bagName,string condition,string material,string imageURI,string dashTxId))"
    ];

    const contract = new ethers.Contract(contractAddress, ABI, provider);
    let owner;
    try {
      owner = await contract.ownerOf(tokenId);
    } catch {
      return res.status(404).json({
        success: false,
        error: `Token ${tokenId} does not exist (not minted yet).`
      });
    }

    const metadata = await contract.getBagMetadata(tokenId);

    return res.json({
      success: true,
      tokenId,
      owner,
      metadata: {
        bagName: metadata.bagName,
        condition: metadata.condition,
        material: metadata.material,
        imageURI: metadata.imageURI,
        dashTxId: metadata.dashTxId
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || String(err)
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

app.get("/catalog", async (req, res) => {
  try {
    const { rpcUrl, contractAddress } = getConfig(false);
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const ABI = [
      "function ownerOf(uint256 tokenId) view returns (address)",
      "function getBagMetadata(uint256) view returns (tuple(string bagName,string condition,string material,string imageURI,string dashTxId))",
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
    ];

    const contract = new ethers.Contract(contractAddress, ABI, provider);
    const iface = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"]);

    // Fetch Transfer logs and consider mints (from === zero address)
    const transferTopic = ethers.id("Transfer(address,address,uint256)");
    const logs = await provider.getLogs({ address: contractAddress, fromBlock: 0, toBlock: "latest", topics: [transferTopic] });

    const mintedTokenIds = [];
    for (const log of logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "Transfer") {
          const from = parsed.args.from;
          const tokenId = parsed.args.tokenId.toString();
          // minted when from is zero address
          if (from === ethers.ZeroAddress || from === "0x0000000000000000000000000000000000000000") {
            mintedTokenIds.push(Number(tokenId));
          }
        }
      } catch (e) {
        // ignore
      }
    }

    // Remove duplicates and sort
    const unique = Array.from(new Set(mintedTokenIds)).sort((a, b) => a - b);

    const items = [];
    for (const id of unique) {
      try {
        const owner = await contract.ownerOf(id);
        const meta = await contract.getBagMetadata(id);
        items.push({
          tokenId: id,
          bagName: meta.bagName,
          condition: meta.condition,
          material: meta.material,
          imageURI: meta.imageURI || "",
          dashTxId: meta.dashTxId || "",
          owner
        });
      } catch (e) {
        // if a token was burned or inaccessible, skip
      }
    }

    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});