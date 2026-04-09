import express from "express";
import { ethers } from "ethers";
import { mintLuxuryPassport } from "./mint.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("."));

// Return JSON on body parse errors (invalid JSON) instead of HTML error page
app.use((err, req, res, next) => {
  // body-parser JSON errors come through here; normalize to JSON response
  if (err) {
    const isBadJson = err.type === 'entity.parse.failed' ||
      err instanceof SyntaxError ||
      (err.status === 400 && typeof err.message === 'string' && err.message.toLowerCase().includes('json'));

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

app.post("/mint", async (req, res) => {
  try {
    const { bagName, condition, material } = req.body;

    if (!bagName || !condition || !material) {
      return res.status(400).json({ error: "bagName, condition, and material are required." });
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
      material
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
      "function getBagMetadata(uint256) view returns (tuple(string bagName,string condition,string material))"
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
        material: metadata.material
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
      "function getBagMetadata(uint256) view returns (tuple(string bagName,string condition,string material))",
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