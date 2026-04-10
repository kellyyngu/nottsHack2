import express from "express";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ethers } from "ethers";
import { mintLuxuryPassport } from "./mint.js";

const app = express();
const PORT = process.env.PORT || 3000;

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
    const { bagName, condition, material, imageURI } = req.body;

    if (!bagName || !condition || !material || !imageURI) {
      return res.status(400).json({ error: "bagName, condition, material and imageURI are required." });
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
      imageURI
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
      "function getBagMetadata(uint256) view returns (tuple(string bagName,string condition,string material,string imageURI))"
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
        imageURI: metadata.imageURI
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
      "function getBagMetadata(uint256) view returns (tuple(string bagName,string condition,string material,string imageURI))",
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