import express from "express";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ethers } from "ethers";
import dotenv from "dotenv";
import { mintLuxuryPassport } from "./mint.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const DASH_NETWORK = (process.env.DASH_NETWORK || "testnet").toLowerCase();
const DASH_MERCHANT_ADDRESS = process.env.DASH_MERCHANT_ADDRESS || "";
const DASH_MIN_PAYMENT = Number(process.env.DASH_MIN_PAYMENT || "0");
const STORAGE_CHAIN_NAME = process.env.STORAGE_CHAIN_NAME || "sepolia";
const STORAGE_CHAIN_ID = Number(process.env.STORAGE_CHAIN_ID || "11155111");
const ENFORCE_STORAGE_CHAIN = String(process.env.ENFORCE_STORAGE_CHAIN || "false").toLowerCase() === "true";
const DASH_EXPLORER_BASE_URL =
  process.env.DASH_EXPLORER_BASE_URL ||
  (DASH_NETWORK === "mainnet" ? "https://api.blockchair.com/dash" : "https://api.blockchair.com/dash/testnet");
const ENABLE_IDENTITY_TRANSFER_ON_VERIFY = String(process.env.ENABLE_IDENTITY_TRANSFER_ON_VERIFY || "true").toLowerCase() === "true";
const ENABLE_IDENTITY_TRANSFER_ON_MINT = String(process.env.ENABLE_IDENTITY_TRANSFER_ON_MINT || "true").toLowerCase() === "true";
const ENABLE_IDENTITY_TRANSFER_ON_BUY = String(process.env.ENABLE_IDENTITY_TRANSFER_ON_BUY || "true").toLowerCase() === "true";
const IDENTITY_TRANSFER_STRICT = String(process.env.IDENTITY_TRANSFER_STRICT || "false").toLowerCase() === "true";
const DEFAULT_VERIFY_TRANSFER_CREDITS = Number(process.env.IDENTITY_TRANSFER_VERIFY_CREDITS || "1000000");
const DEFAULT_MINT_TRANSFER_CREDITS = Number(process.env.IDENTITY_TRANSFER_MINT_CREDITS || "1000000");
const DEFAULT_BUY_TRANSFER_CREDITS = Number(process.env.IDENTITY_TRANSFER_BUY_CREDITS || "1000000");
const MERCHANT_IDENTITY_ID = String(process.env.MERCHANT_IDENTITY_ID || process.env.RECIPIENT_IDENTITY_ID || "").trim();
const MINT_VERIFY_CHALLENGE_TTL_MS = Number(process.env.MINT_VERIFY_CHALLENGE_TTL_MS || "300000");
const MINT_TRANSFER_SESSION_TTL_MS = Number(process.env.MINT_TRANSFER_SESSION_TTL_MS || "900000");
const CATALOG_FROM_BLOCK = asNonNegativeInteger(process.env.CATALOG_FROM_BLOCK, 0);
const LISTING_MODES = new Set(["fixed", "auction", "donate"]);
const tokenListings = new Map();
const tokenBids = new Map();
const walletActivity = new Map();
const mintTransferChallenges = new Map();
const mintTransferSessions = new Map();
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001"
]);

app.use(express.json({ limit: "10mb" }));

app.use((req, res, next) => {
  const origin = String(req.headers.origin || "").trim();
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

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
  const rpcUrl = String(process.env.RPC_URL || "").trim();
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const privateKey = process.env.PRIVATE_KEY;

  if (!rpcUrl) {
    throw new Error("Set RPC_URL environment variable (example: https://sepolia.base.org).");
  }

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

function asTokenId(value) {
  const num = Number(value);
  return Number.isInteger(num) && num >= 0 ? num : null;
}

function asPositiveNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function asPositiveInteger(value) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function asNonNegativeInteger(value, fallback = 0) {
  const num = Number(value);
  return Number.isInteger(num) && num >= 0 ? num : fallback;
}

const BAG_METADATA_ABI_WITH_DESCRIPTION = [
  "function getBagMetadata(uint256) view returns (tuple(string bagName,string itemDescription,string condition,string material,string imageURI,string dashTxId))"
];
const BAG_METADATA_ABI_LEGACY = [
  "function getBagMetadata(uint256) view returns (tuple(string bagName,string condition,string material,string imageURI,string dashTxId))"
];

async function getBagMetadataCompat(provider, contractAddress, tokenId) {
  try {
    const withDescription = new ethers.Contract(contractAddress, BAG_METADATA_ABI_WITH_DESCRIPTION, provider);
    const metadata = await withDescription.getBagMetadata(tokenId);
    return {
      bagName: metadata.bagName,
      itemDescription: metadata.itemDescription || "",
      condition: metadata.condition,
      material: metadata.material,
      imageURI: metadata.imageURI,
      dashTxId: metadata.dashTxId,
      schema: "with-description"
    };
  } catch {
    const legacy = new ethers.Contract(contractAddress, BAG_METADATA_ABI_LEGACY, provider);
    const metadata = await legacy.getBagMetadata(tokenId);
    return {
      bagName: metadata.bagName,
      itemDescription: "",
      condition: metadata.condition,
      material: metadata.material,
      imageURI: metadata.imageURI,
      dashTxId: metadata.dashTxId,
      schema: "legacy"
    };
  }
}

function cleanupExpiredTransferState() {
  const now = Date.now();

  for (const [challengeId, challenge] of mintTransferChallenges.entries()) {
    const expiresAt = Date.parse(challenge?.expiresAt || "");
    if (!Number.isFinite(expiresAt) || expiresAt <= now || challenge?.used) {
      mintTransferChallenges.delete(challengeId);
    }
  }

  for (const [sessionToken, session] of mintTransferSessions.entries()) {
    const expiresAt = Date.parse(session?.expiresAt || "");
    if (!Number.isFinite(expiresAt) || expiresAt <= now || session?.used) {
      mintTransferSessions.delete(sessionToken);
    }
  }
}

function createMintTransferChallenge({ minterIdentityId, amountCredits, identityIndex }) {
  cleanupExpiredTransferState();

  const challengeId = randomUUID();
  const expiresAt = new Date(Date.now() + MINT_VERIFY_CHALLENGE_TTL_MS).toISOString();
  mintTransferChallenges.set(challengeId, {
    challengeId,
    minterIdentityId,
    amountCredits,
    merchantIdentityId: MERCHANT_IDENTITY_ID,
    identityIndex,
    used: false,
    createdAt: new Date().toISOString(),
    expiresAt
  });

  return { challengeId, expiresAt };
}

function createMintTransferSession({ challengeId, transferResult, minterIdentityId, amountCredits }) {
  cleanupExpiredTransferState();

  const sessionToken = randomUUID();
  const expiresAt = new Date(Date.now() + MINT_TRANSFER_SESSION_TTL_MS).toISOString();
  mintTransferSessions.set(sessionToken, {
    challengeId,
    minterIdentityId,
    merchantIdentityId: MERCHANT_IDENTITY_ID,
    amountCredits,
    transferResult,
    used: false,
    createdAt: new Date().toISOString(),
    expiresAt
  });

  return { sessionToken, expiresAt };
}

function recordWalletActivity(walletId, entry) {
  const normalizedWalletId = String(walletId || "").trim();
  if (!normalizedWalletId) {
    return;
  }

  const existing = walletActivity.get(normalizedWalletId) || [];
  existing.push({
    ...entry,
    timestamp: new Date().toISOString()
  });
  walletActivity.set(normalizedWalletId, existing);
}

function getWalletActivity(walletId) {
  const normalizedWalletId = String(walletId || "").trim();
  if (!normalizedWalletId) {
    return [];
  }

  const records = walletActivity.get(normalizedWalletId) || [];
  return [...records].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

function getRewardForTransactionCount(transactionCount) {
  if (transactionCount >= 20) {
    return {
      tier: "partnered-shop",
      discountPercent: 20,
      label: "Partnered Shop Reward",
      description: "20% discount and access to partnered shop discounts"
    };
  }

  if (transactionCount >= 10) {
    return {
      tier: "gold",
      discountPercent: 20,
      label: "20% Discount",
      description: "20% discount unlocked"
    };
  }

  if (transactionCount >= 2) {
    return {
      tier: "starter",
      discountPercent: 10,
      label: "10% Discount",
      description: "10% discount unlocked"
    };
  }

  return {
    tier: "none",
    discountPercent: 0,
    label: "No Reward Yet",
    description: "Complete more transactions to unlock rewards"
  };
}

function getWalletStats(walletId) {
  const records = getWalletActivity(walletId);
  const transactionCount = records.length;
  const listingCount = records.filter((record) => record.type === "listing_created").length;
  const bidCount = records.filter((record) => record.type === "bid_placed").length;
  const reward = getRewardForTransactionCount(transactionCount);

  return {
    walletId: String(walletId || "").trim(),
    transactionCount,
    listingCount,
    bidCount,
    reward,
    lastActivityAt: records.length ? records[0].timestamp : null
  };
}

function normalizeListingInput(input) {
  const mode = String(input?.mode || "fixed").toLowerCase();
  if (!LISTING_MODES.has(mode)) {
    throw new Error("listing.mode must be one of: fixed, auction, donate.");
  }

  const sellerWalletId = String(input?.sellerWalletId || "").trim();
  const now = Date.now();
  const endAtRaw = String(input?.listingEndTime || input?.endsAt || "").trim();
  const endAtMs = Date.parse(endAtRaw);
  if (!endAtRaw || !Number.isFinite(endAtMs) || endAtMs <= now) {
    throw new Error("listingEndTime must be a valid future datetime.");
  }
  const endsAt = new Date(endAtMs).toISOString();

  if (mode === "fixed") {
    const fixedPriceDash = asPositiveNumber(input?.fixedPriceDash);
    if (!fixedPriceDash) {
      throw new Error("fixedPriceDash must be a positive number for fixed-price listings.");
    }

    return {
      mode,
      fixedPriceDash,
      sellerWalletId,
      active: true,
      createdAt: new Date(now).toISOString(),
      endsAt
    };
  }

  if (mode === "auction") {
    const startBidDash = asPositiveNumber(input?.startBidDash);
    if (!startBidDash) {
      throw new Error("startBidDash must be a positive number for auctions.");
    }

    return {
      mode,
      startBidDash,
      sellerWalletId,
      active: true,
      createdAt: new Date(now).toISOString(),
      endsAt
    };
  }

  return {
    mode: "donate",
    sellerWalletId,
    active: true,
    createdAt: new Date(now).toISOString(),
    endsAt
  };
}

function cloneListingForResponse(tokenId) {
  const listing = tokenListings.get(tokenId);
  if (!listing) {
    return null;
  }

  const bids = tokenBids.get(tokenId) || [];
  const highestBid = bids.length
    ? bids.reduce((best, current) => (current.amountDash > best.amountDash ? current : best), bids[0])
    : null;

  return {
    ...listing,
    highestBid: highestBid
      ? {
        walletId: highestBid.walletId,
        amountDash: highestBid.amountDash,
        createdAt: highestBid.createdAt
      }
      : null,
    bidCount: bids.length
  };
}

function clearExpiredListingIfNeeded(tokenId) {
  const listing = tokenListings.get(tokenId);
  if (!listing || !listing.endsAt) {
    return;
  }

  const now = Date.now();
  const end = Date.parse(listing.endsAt);
  if (Number.isFinite(end) && end <= now) {
    tokenListings.delete(tokenId);
    tokenBids.delete(tokenId);
  }
}

function getHighestBidAmount(tokenId) {
  const bids = tokenBids.get(tokenId) || [];
  if (!bids.length) {
    return 0;
  }

  return bids.reduce((best, current) => (current.amountDash > best ? current.amountDash : best), 0);
}

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

async function performIdentityTransfer({
  recipientId,
  amountCredits,
  identityIndex = 0,
  senderWalletId = "",
  metadata = {}
}) {
  const normalizedRecipientId = String(recipientId || "").trim();
  const normalizedAmount = asPositiveInteger(amountCredits);
  const normalizedIdentityIndex = asNonNegativeInteger(identityIndex, 0);

  if (!normalizedRecipientId || !normalizedAmount) {
    return {
      attempted: false,
      success: false,
      error: "recipientId and positive amountCredits are required for identity transfer."
    };
  }

  let sdk;
  try {
    const { setupDashClient } = await import("./setupDashClient.mjs");
    const setup = await setupDashClient({ identityIndex: normalizedIdentityIndex });
    sdk = setup?.sdk;
    const keyManager = setup?.keyManager;

    if (!sdk || !keyManager) {
      throw new Error("Dash identity signer is not configured. Set PLATFORM_MNEMONIC in environment.");
    }

    const { identity, signer } = await keyManager.getTransfer();
    const result = await sdk.identities.creditTransfer({
      identity,
      recipientId: normalizedRecipientId,
      amount: BigInt(normalizedAmount),
      signer,
    });

    const senderIdentityId = identity?.id?.toString ? identity.id.toString() : String(identity?.id || "");
    const resultId = result?.id?.toString?.() || result?.proof?.coreChainLockedHeight || "submitted";

    if (senderWalletId) {
      recordWalletActivity(senderWalletId, {
        type: "identity_transfer_sent",
        recipientId: normalizedRecipientId,
        senderIdentityId,
        amountCredits: normalizedAmount,
        resultId: String(resultId),
        ...metadata
      });
    }

    recordWalletActivity(normalizedRecipientId, {
      type: "identity_transfer_received",
      senderIdentityId,
      amountCredits: normalizedAmount,
      resultId: String(resultId),
      ...metadata
    });

    return {
      attempted: true,
      success: true,
      senderIdentityId,
      recipientId: normalizedRecipientId,
      amountCredits: normalizedAmount,
      resultId: String(resultId)
    };
  } catch (err) {
    return {
      attempted: true,
      success: false,
      error: err.message || String(err)
    };
  } finally {
    try {
      if (sdk?.disconnect) {
        await sdk.disconnect();
      }
    } catch {
      // ignore cleanup failures
    }
  }
}

app.get("/dash/payment-info", (_req, res) => {
  if (!DASH_MERCHANT_ADDRESS && !MERCHANT_IDENTITY_ID) {
    return res.status(500).json({
      success: false,
      error: "Set DASH_MERCHANT_ADDRESS or MERCHANT_IDENTITY_ID in environment before accepting payments."
    });
  }

  return res.json({
    success: true,
    paymentModel: "identity-transfer-to-merchant + developer-sponsored-sepolia-storage",
    network: DASH_NETWORK,
    merchantAddress: DASH_MERCHANT_ADDRESS,
    merchantIdentityId: MERCHANT_IDENTITY_ID,
    minimumDash: DASH_MIN_PAYMENT,
    minimumTransferCredits: DEFAULT_VERIFY_TRANSFER_CREDITS,
    verificationMode: "identity-transfer",
    storageChain: STORAGE_CHAIN_NAME,
    storageCurrency: "ETH",
    nftStorage: "NFT metadata is written on Sepolia",
    storageFeePayer: "developer-backend-signer",
    explorerTxPrefix: DASH_NETWORK === "mainnet"
      ? "https://blockchair.com/dash/transaction/"
      : "https://blockchair.com/dash/testnet/transaction/"
  });
});

app.post("/dash/identity-transfer/challenge", (req, res) => {
  if (!MERCHANT_IDENTITY_ID) {
    return res.status(500).json({
      success: false,
      error: "Set MERCHANT_IDENTITY_ID (or RECIPIENT_IDENTITY_ID) before identity transfer verification."
    });
  }

  const minterIdentityId = String(req.body?.minterIdentityId || req.body?.senderWalletId || "").trim();
  const amountCredits = asPositiveInteger(req.body?.amountCredits) || DEFAULT_VERIFY_TRANSFER_CREDITS;
  const identityIndex = asNonNegativeInteger(req.body?.identityIndex, 0);

  if (!minterIdentityId) {
    return res.status(400).json({ success: false, error: "minterIdentityId is required." });
  }

  const challenge = createMintTransferChallenge({ minterIdentityId, amountCredits, identityIndex });
  return res.json({
    success: true,
    challengeId: challenge.challengeId,
    expiresAt: challenge.expiresAt,
    amountCredits,
    merchantIdentityId: MERCHANT_IDENTITY_ID
  });
});

app.post("/dash/verify-payment", async (req, res) => {
  try {
    cleanupExpiredTransferState();

    const challengeId = String(req.body?.challengeId || "").trim();
    if (challengeId) {
      if (!MERCHANT_IDENTITY_ID) {
        return res.status(500).json({
          success: false,
          error: "Set MERCHANT_IDENTITY_ID (or RECIPIENT_IDENTITY_ID) before identity transfer verification."
        });
      }

      const challenge = mintTransferChallenges.get(challengeId);
      if (!challenge || challenge.used) {
        return res.status(400).json({ success: false, error: "Transfer challenge is invalid or already used." });
      }

      const expiresAtMs = Date.parse(challenge.expiresAt);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        mintTransferChallenges.delete(challengeId);
        return res.status(400).json({ success: false, error: "Transfer challenge expired. Request a new challenge." });
      }

      const minterIdentityId = String(req.body?.minterIdentityId || req.body?.senderWalletId || "").trim();
      const amountCredits = asPositiveInteger(req.body?.amountCredits) || challenge.amountCredits;
      const identityIndex = asNonNegativeInteger(req.body?.identityIndex, challenge.identityIndex || 0);

      if (!minterIdentityId || minterIdentityId !== challenge.minterIdentityId) {
        return res.status(400).json({ success: false, error: "Minter identity does not match challenge." });
      }

      if (amountCredits !== challenge.amountCredits) {
        return res.status(400).json({ success: false, error: "Transfer amount does not match challenge." });
      }

      const identityTransfer = await performIdentityTransfer({
        recipientId: MERCHANT_IDENTITY_ID,
        amountCredits,
        identityIndex,
        senderWalletId: minterIdentityId,
        metadata: { typeContext: "mint_payment_verification", challengeId }
      });

      if (!identityTransfer.success) {
        return res.status(502).json({ success: false, error: identityTransfer.error || "Identity transfer verification failed." });
      }

      challenge.used = true;
      challenge.usedAt = new Date().toISOString();
      mintTransferChallenges.set(challengeId, challenge);

      const session = createMintTransferSession({
        challengeId,
        transferResult: identityTransfer,
        minterIdentityId,
        amountCredits
      });

      return res.json({
        success: true,
        verificationMode: "identity-transfer",
        paymentVerified: true,
        amountCredits,
        merchantIdentityId: MERCHANT_IDENTITY_ID,
        transferSessionToken: session.sessionToken,
        transferSessionExpiresAt: session.expiresAt,
        identityTransfer
      });
    }

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

    let identityTransfer = { attempted: false, success: false };
    if (summary.meetsMinimum && ENABLE_IDENTITY_TRANSFER_ON_VERIFY) {
      const transferRecipientId = String(
        req.body?.recipientId || req.body?.identityRecipientId || req.body?.walletId || ""
      ).trim();
      const transferCredits = asPositiveInteger(req.body?.amountCredits) || DEFAULT_VERIFY_TRANSFER_CREDITS;
      const transferIdentityIndex = asNonNegativeInteger(req.body?.identityIndex, 0);
      const senderWalletId = String(req.body?.senderWalletId || "").trim();

      if (transferRecipientId) {
        identityTransfer = await performIdentityTransfer({
          recipientId: transferRecipientId,
          amountCredits: transferCredits,
          identityIndex: transferIdentityIndex,
          senderWalletId,
          metadata: { typeContext: "payment_verification", txid }
        });

        if (IDENTITY_TRANSFER_STRICT && identityTransfer.attempted && !identityTransfer.success) {
          throw new Error(identityTransfer.error || "Identity transfer failed during payment verification.");
        }
      }
    }

    return res.json({ success: true, ...summary, identityTransfer });
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
    cleanupExpiredTransferState();

    const { bagName, itemDescription, condition, material, imageURI, dashTxId, listing, transferSessionToken } = req.body;
    const normalizedItemDescription = String(itemDescription || "").trim();
    const normalizedTransferSessionToken = String(transferSessionToken || "").trim();
    const hasTransferSession = Boolean(normalizedTransferSessionToken);

    if (!bagName || !condition || !material || !imageURI) {
      return res.status(400).json({ error: "bagName, condition, material and imageURI are required." });
    }

    if (!hasTransferSession && !DASH_MERCHANT_ADDRESS) {
      return res.status(500).json({ success: false, error: "Set DASH_MERCHANT_ADDRESS before minting with payments." });
    }

    let payment = null;
    let transferSession = null;
    let effectiveDashTxId = String(dashTxId || "").trim();

    if (hasTransferSession) {
      transferSession = mintTransferSessions.get(normalizedTransferSessionToken);
      if (!transferSession || transferSession.used) {
        return res.status(400).json({ success: false, error: "Transfer session is invalid, used, or expired." });
      }

      const expiresAtMs = Date.parse(transferSession.expiresAt);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        mintTransferSessions.delete(normalizedTransferSessionToken);
        return res.status(400).json({ success: false, error: "Transfer session expired. Verify transfer again." });
      }

      const proofId = transferSession.transferResult?.resultId || normalizedTransferSessionToken;
      effectiveDashTxId = `identity-transfer:${String(proofId)}`;
    } else {
      if (!isValidDashTxid(effectiveDashTxId)) {
        return res.status(400).json({ success: false, error: "Invalid Dash txid format." });
      }

      payment = await getDashPaymentSummary(effectiveDashTxId);
      if (!payment.meetsMinimum) {
        return res.status(400).json({
          success: false,
          error: `Dash payment below minimum. Received ${payment.receivedDash} DASH, require at least ${DASH_MIN_PAYMENT} DASH.`
        });
      }
    }

    const { rpcUrl, contractAddress, privateKey } = getConfig(true);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(privateKey, provider);
    const signerAddress = await signer.getAddress();
    const chain = await provider.getNetwork();
    const chainId = Number(chain.chainId);

    if (ENFORCE_STORAGE_CHAIN && chainId !== STORAGE_CHAIN_ID) {
      return res.status(500).json({
        success: false,
        error: `Storage signer RPC is on chainId ${chainId}, expected ${STORAGE_CHAIN_ID} (${STORAGE_CHAIN_NAME}).`
      });
    }

    const result = await mintLuxuryPassport({
      contractAddress,
      signer,
      to: signerAddress,
      bagName,
      itemDescription: normalizedItemDescription,
      condition,
      material,
      imageURI,
      dashTxId: effectiveDashTxId
    });

    // Prefer helper-returned tokenId; fall back to decoding ERC-721 Transfer log.
    let tokenId = result?.tokenId != null ? String(result.tokenId) : null;
    try {
      if (tokenId === null) {
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
      }
    } catch {
      tokenId = null;
    }

    const gasUsed = result.receipt?.gasUsed ?? null;
    const effectiveGasPrice = result.receipt?.gasPrice ?? null;
    const ethStorageFeeWei = gasUsed && effectiveGasPrice ? gasUsed * effectiveGasPrice : null;
    const ethStorageFee = ethStorageFeeWei ? ethers.formatEther(ethStorageFeeWei) : null;

    let listingSummary = null;
    let identityTransfer = transferSession?.transferResult
      ? { ...transferSession.transferResult, attempted: true, success: true }
      : { attempted: false, success: false };
    if (tokenId !== null) {
      const normalizedListing = normalizeListingInput(listing || {});
      tokenListings.set(Number(tokenId), normalizedListing);
      tokenBids.delete(Number(tokenId));
      listingSummary = cloneListingForResponse(Number(tokenId));

      if (!hasTransferSession && ENABLE_IDENTITY_TRANSFER_ON_MINT) {
        const transferRecipientId = String(
          req.body?.recipientId || req.body?.identityRecipientId || normalizedListing.sellerWalletId || ""
        ).trim();
        const transferCredits = asPositiveInteger(req.body?.amountCredits) || DEFAULT_MINT_TRANSFER_CREDITS;
        const transferIdentityIndex = asNonNegativeInteger(req.body?.identityIndex, 0);

        if (transferRecipientId) {
          identityTransfer = await performIdentityTransfer({
            recipientId: transferRecipientId,
            amountCredits: transferCredits,
            identityIndex: transferIdentityIndex,
            senderWalletId: normalizedListing.sellerWalletId,
            metadata: { typeContext: "mint_passport", tokenId: Number(tokenId), dashTxId: effectiveDashTxId }
          });

          if (IDENTITY_TRANSFER_STRICT && identityTransfer.attempted && !identityTransfer.success) {
            throw new Error(identityTransfer.error || "Identity transfer failed during mint.");
          }
        }
      }

      if (normalizedListing.sellerWalletId) {
        recordWalletActivity(normalizedListing.sellerWalletId, {
          type: "listing_created",
          tokenId: Number(tokenId),
          bagName,
          listingMode: normalizedListing.mode,
          fixedPriceDash: normalizedListing.fixedPriceDash || null,
          startBidDash: normalizedListing.startBidDash || null,
          endsAt: normalizedListing.endsAt,
          dashTxId: effectiveDashTxId
        });
      }
    }

    if (hasTransferSession && transferSession) {
      transferSession.used = true;
      transferSession.usedAt = new Date().toISOString();
      mintTransferSessions.set(normalizedTransferSessionToken, transferSession);
    }

    return res.json({
      success: true,
      paymentModel: "dash-user-payments + developer-sponsored-sepolia-storage",
      txHash: result.hash,
      dashTxId: effectiveDashTxId,
      tokenId,
      blockNumber: result.receipt?.blockNumber ?? null,
      paymentVerification: hasTransferSession
        ? {
          method: "identity-transfer",
          transferSessionToken: normalizedTransferSessionToken,
          minterIdentityId: transferSession?.minterIdentityId || null,
          merchantIdentityId: transferSession?.merchantIdentityId || MERCHANT_IDENTITY_ID,
          amountCredits: transferSession?.amountCredits || null
        }
        : {
          method: "dash-txid",
          txid: effectiveDashTxId,
          receivedDash: payment?.receivedDash ?? null,
          confirmations: payment?.confirmations ?? null
        },
      nftStorage: {
        chain: STORAGE_CHAIN_NAME,
        chainId,
        contractAddress,
        owner: signerAddress,
        storageFeeCurrency: "ETH",
        storageFeePayer: signerAddress,
        estimatedStorageFeeEth: ethStorageFee
      },
      listing: listingSummary,
      metadataSchema: result.metadataSchema || "legacy",
      identityTransfer
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

    clearExpiredListingIfNeeded(tokenId);

    if (!Number.isInteger(tokenId) || tokenId < 0) {
      return res.status(400).json({
        success: false,
        error: "tokenId must be a non-negative integer. Example: /read?tokenId=0"
      });
    }

    const { rpcUrl, contractAddress } = getConfig(false);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const ABI = ["function ownerOf(uint256 tokenId) view returns (address)"];

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

    const metadata = await getBagMetadataCompat(provider, contractAddress, tokenId);

    return res.json({
      success: true,
      tokenId,
      owner,
      metadata: {
        bagName: metadata.bagName,
        itemDescription: metadata.itemDescription,
        condition: metadata.condition,
        material: metadata.material,
        imageURI: metadata.imageURI,
        dashTxId: metadata.dashTxId
      },
      metadataSchema: metadata.schema,
      listing: cloneListingForResponse(tokenId)
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

app.get("/runtime-config", async (_req, res) => {
  try {
    const { rpcUrl, contractAddress } = getConfig(false);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const network = await provider.getNetwork();
    return res.json({
      success: true,
      rpcUrl,
      contractAddress,
      chainId: Number(network.chainId),
      chainName: network.name,
      expectedChainId: STORAGE_CHAIN_ID,
      enforceStorageChain: ENFORCE_STORAGE_CHAIN
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
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
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
    ];

    const contract = new ethers.Contract(contractAddress, ABI, provider);
    const iface = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"]);

    // Fetch Transfer logs in chunks to handle RPC providers that cap block ranges per eth_getLogs call.
    const transferTopic = ethers.id("Transfer(address,address,uint256)");
    const latestBlock = await provider.getBlockNumber();
    const maxRange = 9999;
    const startBlock = Math.min(CATALOG_FROM_BLOCK || latestBlock, latestBlock);
    const logs = [];
    for (let fromBlock = startBlock; fromBlock <= latestBlock; fromBlock += maxRange + 1) {
      const toBlock = Math.min(fromBlock + maxRange, latestBlock);
      const chunk = await provider.getLogs({
        address: contractAddress,
        fromBlock,
        toBlock,
        topics: [transferTopic]
      });
      if (chunk.length) {
        logs.push(...chunk);
      }
    }

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
        clearExpiredListingIfNeeded(id);
        const owner = await contract.ownerOf(id);
        const meta = await getBagMetadataCompat(provider, contractAddress, id);
        items.push({
          tokenId: id,
          bagName: meta.bagName,
          itemDescription: meta.itemDescription,
          condition: meta.condition,
          material: meta.material,
          imageURI: meta.imageURI || "",
          dashTxId: meta.dashTxId || "",
          owner,
          listing: cloneListingForResponse(id)
        });
      } catch (e) {
        // if a token was burned or inaccessible, skip
      }
    }

    return res.json({
      items,
      debug: {
        contractAddress,
        latestBlock,
        startBlock,
        transferLogCount: logs.length,
        mintedTokenCount: unique.length
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

app.get("/listing/:tokenId", (req, res) => {
  const tokenId = asTokenId(req.params.tokenId);
  if (tokenId === null) {
    return res.status(400).json({ success: false, error: "Invalid tokenId." });
  }

  clearExpiredListingIfNeeded(tokenId);
  const listing = cloneListingForResponse(tokenId);
  if (!listing) {
    return res.status(404).json({ success: false, error: "No active listing for this item." });
  }

  return res.json({ success: true, tokenId, listing });
});

app.post("/listing/:tokenId/bid", (req, res) => {
  const tokenId = asTokenId(req.params.tokenId);
  if (tokenId === null) {
    return res.status(400).json({ success: false, error: "Invalid tokenId." });
  }

  clearExpiredListingIfNeeded(tokenId);
  const listing = tokenListings.get(tokenId);
  if (!listing || listing.mode !== "auction") {
    return res.status(400).json({ success: false, error: "This item is not accepting auction bids." });
  }

  const walletId = String(req.body?.walletId || "").trim();
  const amountDash = asPositiveNumber(req.body?.amountDash);

  if (!walletId) {
    return res.status(400).json({ success: false, error: "walletId is required." });
  }

  if (!amountDash) {
    return res.status(400).json({ success: false, error: "amountDash must be a positive number." });
  }

  const highestBidAmount = getHighestBidAmount(tokenId);
  const minimumRequired = Math.max(Number(listing.startBidDash || 0), highestBidAmount + 0.00000001);
  if (amountDash < minimumRequired) {
    return res.status(400).json({
      success: false,
      error: `Bid must be at least ${minimumRequired.toFixed(8)} DASH.`
    });
  }

  const bids = tokenBids.get(tokenId) || [];
  const bid = {
    walletId,
    amountDash,
    createdAt: new Date().toISOString()
  };
  bids.push(bid);
  tokenBids.set(tokenId, bids);

  recordWalletActivity(walletId, {
    type: "bid_placed",
    tokenId,
    amountDash,
    listingMode: listing.mode,
    endsAt: listing.endsAt || null
  });

  return res.json({
    success: true,
    tokenId,
    bid,
    listing: cloneListingForResponse(tokenId)
  });
});

app.post("/listing/:tokenId/buy", async (req, res) => {
  const tokenId = asTokenId(req.params.tokenId);
  if (tokenId === null) {
    return res.status(400).json({ success: false, error: "Invalid tokenId." });
  }

  clearExpiredListingIfNeeded(tokenId);
  const listing = tokenListings.get(tokenId);
  if (!listing || (listing.mode !== "fixed" && listing.mode !== "donate")) {
    return res.status(400).json({ success: false, error: "This item is not available for direct purchase." });
  }

  const buyerWalletId = String(req.body?.buyerWalletId || req.body?.walletId || "").trim();
  const dashTxId = String(req.body?.dashTxId || "").trim();
  if (!buyerWalletId) {
    return res.status(400).json({ success: false, error: "buyerWalletId is required." });
  }
  if (!isValidDashTxid(dashTxId)) {
    return res.status(400).json({ success: false, error: "Valid dashTxId is required." });
  }

  try {
    const payment = await getDashPaymentSummary(dashTxId);
    if (!payment.meetsMinimum) {
      return res.status(400).json({
        success: false,
        error: `Dash payment below minimum. Received ${payment.receivedDash} DASH, require at least ${DASH_MIN_PAYMENT} DASH.`
      });
    }

    if (listing.mode === "fixed") {
      const requiredDash = Number(listing.fixedPriceDash || 0);
      if (requiredDash > 0 && payment.receivedDash < requiredDash) {
        return res.status(400).json({
          success: false,
          error: `Payment too low for this item. Received ${payment.receivedDash} DASH, requires ${requiredDash} DASH.`
        });
      }
    }

    let identityTransfer = { attempted: false, success: false };
    if (ENABLE_IDENTITY_TRANSFER_ON_BUY) {
      const transferRecipientId = String(listing.sellerWalletId || req.body?.recipientId || req.body?.identityRecipientId || "").trim();
      const transferCredits = asPositiveInteger(req.body?.amountCredits) || DEFAULT_BUY_TRANSFER_CREDITS;
      const transferIdentityIndex = asNonNegativeInteger(req.body?.identityIndex, 0);

      if (!transferRecipientId) {
        return res.status(400).json({
          success: false,
          error: "Listing sellerWalletId (recipient identity) is required for identity transfer during purchase."
        });
      }

      identityTransfer = await performIdentityTransfer({
        recipientId: transferRecipientId,
        amountCredits: transferCredits,
        identityIndex: transferIdentityIndex,
        senderWalletId: buyerWalletId,
        metadata: { typeContext: "marketplace_buy", tokenId, dashTxId }
      });

      if (IDENTITY_TRANSFER_STRICT && identityTransfer.attempted && !identityTransfer.success) {
        throw new Error(identityTransfer.error || "Identity transfer failed during purchase.");
      }
    }

    recordWalletActivity(buyerWalletId, {
      type: "item_purchased",
      tokenId,
      listingMode: listing.mode,
      amountDash: Number(payment.receivedDash),
      sellerWalletId: listing.sellerWalletId || null,
      dashTxId,
      identityTransferSuccess: identityTransfer.success
    });

    if (listing.sellerWalletId) {
      recordWalletActivity(listing.sellerWalletId, {
        type: "item_sold",
        tokenId,
        listingMode: listing.mode,
        amountDash: Number(payment.receivedDash),
        buyerWalletId,
        dashTxId,
        identityTransferSuccess: identityTransfer.success
      });
    }

    tokenListings.delete(tokenId);
    tokenBids.delete(tokenId);

    return res.json({
      success: true,
      tokenId,
      payment,
      identityTransfer,
      message: "Purchase completed and listing closed."
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

app.post("/dash/identity-transfer", async (req, res) => {
  const recipientId = String(req.body?.recipientId || "").trim();
  const amountCredits = asPositiveInteger(req.body?.amountCredits);
  const identityIndexRaw = req.body?.identityIndex;
  const senderWalletId = String(req.body?.senderWalletId || "").trim();
  const identityIndex = Number.isInteger(Number(identityIndexRaw)) && Number(identityIndexRaw) >= 0
    ? Number(identityIndexRaw)
    : 0;

  if (!recipientId) {
    return res.status(400).json({ success: false, error: "recipientId is required." });
  }

  if (!amountCredits) {
    return res.status(400).json({ success: false, error: "amountCredits must be a positive integer." });
  }

  let sdk;
  try {
    const { setupDashClient } = await import("./setupDashClient.mjs");
    const setup = await setupDashClient({ identityIndex });
    sdk = setup?.sdk;
    const keyManager = setup?.keyManager;

    if (!sdk || !keyManager) {
      throw new Error("Dash identity signer is not configured. Set PLATFORM_MNEMONIC in environment.");
    }

    const { identity, signer } = await keyManager.getTransfer();
    const amount = BigInt(amountCredits);
    const result = await sdk.identities.creditTransfer({
      identity,
      recipientId,
      amount,
      signer,
    });

    const senderIdentityId = identity?.id?.toString ? identity.id.toString() : String(identity?.id || "");
    const txLikeId = result?.id?.toString?.() || result?.proof?.coreChainLockedHeight || "submitted";

    if (senderWalletId) {
      recordWalletActivity(senderWalletId, {
        type: "identity_transfer_sent",
        recipientId,
        senderIdentityId,
        amountCredits,
        resultId: String(txLikeId)
      });
    }

    recordWalletActivity(recipientId, {
      type: "identity_transfer_received",
      senderIdentityId,
      amountCredits,
      resultId: String(txLikeId)
    });

    return res.json({
      success: true,
      senderIdentityId,
      recipientId,
      amountCredits,
      resultId: String(txLikeId)
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || String(err) });
  } finally {
    try {
      if (sdk?.disconnect) {
        await sdk.disconnect();
      }
    } catch {
      // ignore cleanup failures
    }
  }
});

app.get("/wallet-activity/summary", (_req, res) => {
  const wallets = Array.from(walletActivity.keys()).map((walletId) => getWalletStats(walletId));

  wallets.sort((a, b) => {
    const left = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
    const right = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
    return right - left;
  });

  return res.json({ success: true, wallets });
});

app.get("/wallet-activity/:walletId", (req, res) => {
  const walletId = String(req.params.walletId || "").trim();
  if (!walletId) {
    return res.status(400).json({ success: false, error: "walletId is required." });
  }

  const stats = getWalletStats(walletId);

  return res.json({
    success: true,
    walletId,
    stats,
    transactions: getWalletActivity(walletId)
  });
});

app.get("/wallet-rewards/summary", (_req, res) => {
  const wallets = Array.from(walletActivity.keys()).map((walletId) => getWalletStats(walletId));

  wallets.sort((a, b) => {
    if (b.transactionCount !== a.transactionCount) {
      return b.transactionCount - a.transactionCount;
    }
    const left = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
    const right = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
    return right - left;
  });

  return res.json({
    success: true,
    rewardRules: [
      { transactions: 2, reward: "10% discount" },
      { transactions: 10, reward: "20% discount" },
      { transactions: 20, reward: "20% + partnered shop discount" }
    ],
    wallets
  });
});

app.get("/wallet-rewards/:walletId", (req, res) => {
  const walletId = String(req.params.walletId || "").trim();
  if (!walletId) {
    return res.status(400).json({ success: false, error: "walletId is required." });
  }

  return res.json({
    success: true,
    walletId,
    stats: getWalletStats(walletId)
  });
});