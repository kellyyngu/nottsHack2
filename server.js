import express from "express";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import Dash from "dash";
import dotenv from "dotenv";
import { mintLuxuryPassport } from "./mint.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 3000;
const bidsFilePath = path.join(process.cwd(), "bidding", "bids.json");
const dashNetwork = process.env.DASH_NETWORK || "testnet";
const dashMnemonic = process.env.DASH_MNEMONIC;
const dashAppName = process.env.DASH_APP_NAME || "ecoTrace";
const dashContractId = process.env.DASH_CONTRACT_ID;
const dashDapiAddresses = process.env.DASH_DAPI_ADDRESSES
  ? process.env.DASH_DAPI_ADDRESSES.split(",").map((value) => value.trim()).filter(Boolean)
  : [];

let dashClient;

function getDashClient() {
  if (!dashMnemonic) {
    throw new Error("Set DASH_MNEMONIC environment variable to use Dash comments.");
  }

  if (!dashContractId) {
    throw new Error("Set DASH_CONTRACT_ID environment variable to use Dash comments.");
  }

  if (!dashClient) {
    const dashClientOptions = {
      network: dashNetwork,
      wallet: { mnemonic: dashMnemonic },
      apps: {
        [dashAppName]: {
          contractId: dashContractId
        }
      }
    };

    if (dashDapiAddresses.length > 0) {
      dashClientOptions.dapiAddresses = dashDapiAddresses;
    }

    dashClient = new Dash.Client(dashClientOptions);
  }

  return dashClient;
}

async function getDashIdentity() {
  const client = getDashClient();
  const account = await client.getWalletAccount();
  const identityId = account.identities.getIdentityIds()[0];

  if (!identityId) {
    throw new Error("No Dash identity is available for the configured wallet.");
  }

  return client.platform.identities.get(identityId);
}

function getCommentDocumentType() {
  return `${dashAppName}.comment`;
}

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

async function readBids() {
  try {
    const raw = await readFile(bidsFilePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

async function saveBids(bids) {
  await mkdir(path.dirname(bidsFilePath), { recursive: true });
  await writeFile(bidsFilePath, JSON.stringify(bids, null, 2));
}

async function fetchCommentsForToken(tokenId) {
  const client = getDashClient();

  const documents = await client.platform.documents.get(getCommentDocumentType(), {
    where: [["tokenId", "==", tokenId]],
  });

  return documents
    .map((document) => ({
      id: document.id,
      tokenId: document.get("tokenId"),
      commenterName: document.get("commenterName"),
      message: document.get("message"),
      timestamp: document.get("timestamp")
    }))
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
}

async function discoverMintedTokenIds(provider, contractAddress) {
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const logs = await provider.getLogs({
    address: contractAddress,
    fromBlock: 0,
    toBlock: "latest",
    topics: [transferTopic]
  });

  const iface = new ethers.Interface([
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
  ]);

  const ids = [];
  for (const log of logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === "Transfer") {
        const from = parsed.args.from;
        const tokenId = Number(parsed.args.tokenId.toString());
        if (from === ethers.ZeroAddress || from === "0x0000000000000000000000000000000000000000") {
          ids.push(tokenId);
        }
      }
    } catch {
      // Ignore unrelated logs.
    }
  }

  return Array.from(new Set(ids)).sort((a, b) => a - b);
}

async function fetchItemByTokenId(contract, tokenId) {
  const owner = await contract.ownerOf(tokenId);
  const meta = await contract.getBagMetadata(tokenId);

  return {
    tokenId,
    bagName: meta.bagName,
    condition: meta.condition,
    material: meta.material,
    imageURI: meta.imageURI || "",
    startBidWei: meta.startBidWei.toString(),
    startBidEth: ethers.formatUnits(meta.startBidWei, 18),
    bidEndTime: meta.bidEndTime.toString(),
    bidEndTimeIso: new Date(Number(meta.bidEndTime) * 1000).toISOString(),
    owner
  };
}

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
    const { bagName, condition, material, startBid, bidEndTime, imageURI } = req.body;

    if (!bagName || !condition || !material || startBid === undefined || startBid === null || !bidEndTime || !imageURI) {
      return res.status(400).json({ error: "bagName, condition, material, startBid, bidEndTime and imageURI are required." });
    }

    const startBidText = String(startBid).trim();
    let startBidWei;
    try {
      startBidWei = ethers.parseUnits(startBidText, 18);
    } catch {
      return res.status(400).json({ error: "startBid must be a valid ETH amount." });
    }

    if (startBidWei < 0n) {
      return res.status(400).json({ error: "startBid must be non-negative." });
    }

    const bidEndMs = Date.parse(String(bidEndTime));
    if (!Number.isFinite(bidEndMs)) {
      return res.status(400).json({ error: "bidEndTime must be a valid ISO datetime." });
    }

    const bidEndTimestamp = BigInt(Math.floor(bidEndMs / 1000));
    const nowTimestamp = BigInt(Math.floor(Date.now() / 1000));
    if (bidEndTimestamp <= nowTimestamp) {
      return res.status(400).json({ error: "bidEndTime must be in the future." });
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
      startBidWei,
      bidEndTime: bidEndTimestamp
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
      "function getBagMetadata(uint256) view returns (tuple(string bagName,string condition,string material,string imageURI,uint256 startBidWei,uint256 bidEndTime))"
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
        startBidWei: metadata.startBidWei.toString(),
        startBidEth: ethers.formatUnits(metadata.startBidWei, 18),
        bidEndTime: metadata.bidEndTime.toString(),
        bidEndTimeIso: new Date(Number(metadata.bidEndTime) * 1000).toISOString()
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

app.get("/bids", async (req, res) => {
  try {
    const tokenIdRaw = req.query.tokenId;
    const tokenId = Number(tokenIdRaw);

    if (!Number.isInteger(tokenId) || tokenId < 0) {
      return res.status(400).json({
        success: false,
        error: "tokenId must be a non-negative integer. Example: /bids?tokenId=0"
      });
    }

    const bids = await readBids();
    const tokenBids = bids
      .filter((bid) => Number(bid.tokenId) === tokenId)
      .sort((a, b) => Number(b.amount) - Number(a.amount));

    return res.json({
      success: true,
      tokenId,
      highestBid: tokenBids[0] || null,
      bids: tokenBids
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

app.post("/bids", async (req, res) => {
  try {
    const { tokenId: tokenIdRaw, amount: amountRaw, bidderName } = req.body || {};
    const tokenId = Number(tokenIdRaw);
    const amount = Number(amountRaw);

    if (!Number.isInteger(tokenId) || tokenId < 0) {
      return res.status(400).json({ success: false, error: "tokenId must be a non-negative integer." });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, error: "amount must be a positive number." });
    }

    const cleanBidderName = String(bidderName || "").trim();
    if (!cleanBidderName) {
      return res.status(400).json({ success: false, error: "bidderName is required." });
    }

    const bids = await readBids();
    const currentHighest = bids
      .filter((bid) => Number(bid.tokenId) === tokenId)
      .reduce((max, bid) => Math.max(max, Number(bid.amount) || 0), 0);

    if (amount <= currentHighest) {
      return res.status(400).json({
        success: false,
        error: `Bid must be higher than current highest (${currentHighest}).`
      });
    }

    const newBid = {
      id: randomUUID(),
      tokenId,
      amount,
      bidderName: cleanBidderName,
      timestamp: Date.now()
    };

    bids.push(newBid);
    await saveBids(bids);

    return res.json({ success: true, bid: newBid });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

app.get("/comments", async (req, res) => {
  try {
    const tokenIdRaw = req.query.tokenId;
    const tokenId = Number(tokenIdRaw);

    if (!Number.isInteger(tokenId) || tokenId < 0) {
      return res.status(400).json({
        success: false,
        error: "tokenId must be a non-negative integer. Example: /comments?tokenId=0"
      });
    }

    const comments = await fetchCommentsForToken(tokenId);
    return res.json({ success: true, tokenId, comments });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

app.post("/comments", async (req, res) => {
  try {
    const { tokenId: tokenIdRaw, commenterName, message } = req.body || {};
    const tokenId = Number(tokenIdRaw);
    const cleanCommenterName = String(commenterName || "").trim();
    const cleanMessage = String(message || "").trim();

    if (!Number.isInteger(tokenId) || tokenId < 0) {
      return res.status(400).json({ success: false, error: "tokenId must be a non-negative integer." });
    }

    if (!cleanCommenterName) {
      return res.status(400).json({ success: false, error: "commenterName is required." });
    }

    if (!cleanMessage) {
      return res.status(400).json({ success: false, error: "message is required." });
    }

    const client = getDashClient();
    const identity = await getDashIdentity();

    const commentDocument = await client.platform.documents.create(
      getCommentDocumentType(),
      identity,
      {
        tokenId,
        commenterName: cleanCommenterName,
        message: cleanMessage,
        timestamp: Date.now()
      }
    );

    await client.platform.documents.broadcast({ create: [commentDocument] }, identity);

    return res.json({
      success: true,
      comment: {
        id: commentDocument.id,
        tokenId,
        commenterName: cleanCommenterName,
        message: cleanMessage,
        timestamp: commentDocument.get("timestamp")
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

app.get("/history", async (req, res) => {
  try {
    const user = String(req.query.user || "").trim();
    if (!user) {
      return res.status(400).json({ success: false, error: "user query parameter is required." });
    }

    const { rpcUrl, contractAddress } = getConfig(false);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const ABI = [
      "function ownerOf(uint256 tokenId) view returns (address)",
      "function getBagMetadata(uint256) view returns (tuple(string bagName,string condition,string material,string imageURI,uint256 startBidWei,uint256 bidEndTime))"
    ];

    const contract = new ethers.Contract(contractAddress, ABI, provider);
    const mintedTokenIds = await discoverMintedTokenIds(provider, contractAddress);

    const catalogItems = [];
    for (const id of mintedTokenIds) {
      try {
        const item = await fetchItemByTokenId(contract, id);
        catalogItems.push(item);
      } catch {
        // Skip broken/inaccessible token ids.
      }
    }

    const normalize = (value) => String(value || "").trim().toLowerCase();
    const normalizedUser = normalize(user);

    const listedItems = catalogItems.filter((item) => normalize(item.owner) === normalizedUser);

    const allBids = await readBids();
    const userBids = allBids
      .filter((bid) => normalize(bid.bidderName) === normalizedUser)
      .sort((a, b) => Number(b.timestamp) - Number(a.timestamp));

    const bidTokenIds = Array.from(new Set(userBids.map((bid) => Number(bid.tokenId)).filter((id) => Number.isInteger(id) && id >= 0)));
    const bidItems = [];

    for (const id of bidTokenIds) {
      try {
        let item = catalogItems.find((catalogItem) => catalogItem.tokenId === id);
        if (!item) {
          item = await fetchItemByTokenId(contract, id);
        }

        bidItems.push({
          item,
          bids: userBids.filter((bid) => Number(bid.tokenId) === id)
        });
      } catch {
        // Skip tokens that cannot be resolved.
      }
    }

    return res.json({ success: true, user, listedItems, bidItems });
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
      "function getBagMetadata(uint256) view returns (tuple(string bagName,string condition,string material,string imageURI,uint256 startBidWei,uint256 bidEndTime))",
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
          startBidWei: meta.startBidWei.toString(),
          startBidEth: ethers.formatUnits(meta.startBidWei, 18),
          bidEndTime: meta.bidEndTime.toString(),
          bidEndTimeIso: new Date(Number(meta.bidEndTime) * 1000).toISOString(),
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