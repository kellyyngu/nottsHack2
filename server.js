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
const LISTING_MODES = new Set(["fixed", "auction", "donate"]);
const tokenListings = new Map();
const tokenBids = new Map();
const walletActivity = new Map();

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

function asTokenId(value) {
  const num = Number(value);
  return Number.isInteger(num) && num >= 0 ? num : null;
}

function asPositiveNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
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

app.get("/dash/payment-info", (_req, res) => {
  if (!DASH_MERCHANT_ADDRESS) {
    return res.status(500).json({
      success: false,
      error: "Set DASH_MERCHANT_ADDRESS in environment before accepting payments."
    });
  }

  return res.json({
    success: true,
    paymentModel: "dash-user-payments + developer-sponsored-sepolia-storage",
    network: DASH_NETWORK,
    merchantAddress: DASH_MERCHANT_ADDRESS,
    minimumDash: DASH_MIN_PAYMENT,
    storageChain: STORAGE_CHAIN_NAME,
    storageCurrency: "ETH",
    nftStorage: "NFT metadata is written on Sepolia",
    storageFeePayer: "developer-backend-signer",
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
    const { bagName, condition, material, imageURI, dashTxId, listing } = req.body;

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

    const gasUsed = result.receipt?.gasUsed ?? null;
    const effectiveGasPrice = result.receipt?.gasPrice ?? null;
    const ethStorageFeeWei = gasUsed && effectiveGasPrice ? gasUsed * effectiveGasPrice : null;
    const ethStorageFee = ethStorageFeeWei ? ethers.formatEther(ethStorageFeeWei) : null;

    let listingSummary = null;
    if (tokenId !== null) {
      const normalizedListing = normalizeListingInput(listing || {});
      tokenListings.set(Number(tokenId), normalizedListing);
      tokenBids.delete(Number(tokenId));
      listingSummary = cloneListingForResponse(Number(tokenId));

      if (normalizedListing.sellerWalletId) {
        recordWalletActivity(normalizedListing.sellerWalletId, {
          type: "listing_created",
          tokenId: Number(tokenId),
          bagName,
          listingMode: normalizedListing.mode,
          fixedPriceDash: normalizedListing.fixedPriceDash || null,
          startBidDash: normalizedListing.startBidDash || null,
          endsAt: normalizedListing.endsAt,
          dashTxId
        });
      }
    }

    return res.json({
      success: true,
      paymentModel: "dash-user-payments + developer-sponsored-sepolia-storage",
      txHash: result.hash,
      dashTxId,
      tokenId,
      blockNumber: result.receipt?.blockNumber ?? null,
      nftStorage: {
        chain: STORAGE_CHAIN_NAME,
        chainId,
        contractAddress,
        owner: signerAddress,
        storageFeeCurrency: "ETH",
        storageFeePayer: signerAddress,
        estimatedStorageFeeEth: ethStorageFee
      },
      listing: listingSummary
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
      },
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
        clearExpiredListingIfNeeded(id);
        const owner = await contract.ownerOf(id);
        const meta = await contract.getBagMetadata(id);
        items.push({
          tokenId: id,
          bagName: meta.bagName,
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

    return res.json({ items });
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