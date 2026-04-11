import express from "express";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import Dashcore from "@dashevo/dashcore-lib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, ".env") });

const app = express();
const port = Number(process.env.PORT || 3000);
const networkName = normalizeNetwork(process.env.DASH_NETWORK || "testnet");
const mnemonicText = process.env.DASH_MNEMONIC?.trim();
const walletPassphrase = process.env.DASH_WALLET_PASSPHRASE || "";
const derivationBasePath =
  process.env.DASH_DERIVATION_PATH ||
  `m/44'/${networkName === "livenet" ? 5 : 1}'/0'/0`;
const explorerBaseUrl = (process.env.DASH_EXPLORER_BASE_URL || "https://api.blockchair.com").replace(/\/$/, "");
const explorerNetworkPrefix = process.env.DASH_EXPLORER_NETWORK_PREFIX || "dash";
const storePath = path.join(__dirname, "data", "wallet-payments.json");
const marketplaceStorePath = path.join(__dirname, "data", "marketplace.json");
const uploadsDirPath = path.join(__dirname, "uploads");
const catalogItems = [
  {
    tokenId: 0,
    bagName: "Lady Dior",
    condition: "Excellent",
    material: "Lambskin",
    imageURI: "https://via.placeholder.com/420x420?text=Lady+Dior",
    owner: "Wallet managed",
    listing: { active: false, priceWei: null }
  },
  {
    tokenId: 1,
    bagName: "Neverfull MM",
    condition: "Good",
    material: "Canvas",
    imageURI: "https://via.placeholder.com/420x420?text=Neverfull+MM",
    owner: "Wallet managed",
    listing: { active: false, priceWei: null }
  },
  {
    tokenId: 2,
    bagName: "Classic Flap",
    condition: "Used",
    material: "Caviar",
    imageURI: "https://via.placeholder.com/420x420?text=Classic+Flap",
    owner: "Wallet managed",
    listing: { active: false, priceWei: null }
  }
];

if (!mnemonicText) {
  throw new Error("Set DASH_MNEMONIC in .env to enable the wallet payment flow.");
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

const mnemonic = new Dashcore.Mnemonic(mnemonicText);
const rootKey = mnemonic.toHDPrivateKey(walletPassphrase, networkName);

let paymentStore = await loadPaymentStore();
let marketplaceStore = await loadMarketplaceStore();

function normalizeNetwork(value) {
  const normalized = String(value || "testnet").toLowerCase();

  if (normalized === "mainnet") {
    return "livenet";
  }

  if (normalized === "live") {
    return "livenet";
  }

  return normalized;
}

function deriveAddress(index) {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("Invoice index must be a non-negative integer.");
  }

  const childKey = rootKey.deriveChild(`${derivationBasePath}/${index}`);
  return childKey.privateKey.toAddress(networkName).toString();
}

function satoshisToDash(satoshis) {
  return Number(satoshis) / 100000000;
}

function dashToSatoshis(amountDash) {
  return Math.round(Number(amountDash) * 100000000);
}

function dashToWeiString(amountDash) {
  const text = String(amountDash).trim();

  if (!/^\d+(\.\d+)?$/.test(text)) {
    return "0";
  }

  const [wholePart, fractionalPart = ""] = text.split(".");
  const paddedFractional = `${fractionalPart}000000000000000000`.slice(0, 18);

  return (BigInt(wholePart || "0") * 1000000000000000000n + BigInt(paddedFractional || "0")).toString();
}

function weiToDashString(weiText) {
  try {
    const wei = BigInt(String(weiText || "0"));
    const whole = wei / 1000000000000000000n;
    const fractional = (wei % 1000000000000000000n).toString().padStart(18, "0").replace(/0+$/, "");
    return fractional ? `${whole}.${fractional}` : whole.toString();
  } catch {
    return "0";
  }
}

function createTxHash() {
  return `0x${randomBytes(32).toString("hex")}`;
}

function serializeInvoice(invoice) {
  return {
    id: invoice.id,
    index: invoice.index,
    reference: invoice.reference,
    memo: invoice.memo,
    amountDash: invoice.amountDash,
    amountSatoshis: invoice.amountSatoshis,
    paymentAddress: invoice.paymentAddress,
    network: invoice.network,
    status: invoice.status,
    createdAt: invoice.createdAt,
    expiresAt: invoice.expiresAt,
    paidAt: invoice.paidAt || null,
    lastVerifiedAt: invoice.lastVerifiedAt || null,
    receivedSatoshis: invoice.receivedSatoshis || 0,
    receivedDash: satoshisToDash(invoice.receivedSatoshis || 0)
  };
}

async function loadPaymentStore() {
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw);

    return {
      nextInvoiceIndex: Number.isInteger(parsed.nextInvoiceIndex) && parsed.nextInvoiceIndex > 0 ? parsed.nextInvoiceIndex : 1,
      invoices: Array.isArray(parsed.invoices) ? parsed.invoices : []
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        nextInvoiceIndex: 1,
        invoices: []
      };
    }

    throw error;
  }
}

async function savePaymentStore() {
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(paymentStore, null, 2));
}

async function loadMarketplaceStore() {
  try {
    const raw = await readFile(marketplaceStorePath, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed || !Array.isArray(parsed.items)) {
      return {
        nextTokenId: catalogItems.length,
        items: catalogItems.map((item) => ({ ...item }))
      };
    }

    return {
      nextTokenId: Number.isInteger(parsed.nextTokenId) && parsed.nextTokenId > 0 ? parsed.nextTokenId : Math.max(parsed.items.length, catalogItems.length),
      items: parsed.items
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        nextTokenId: catalogItems.length,
        items: catalogItems.map((item) => ({ ...item }))
      };
    }

    throw error;
  }
}

async function saveMarketplaceStore() {
  await mkdir(path.dirname(marketplaceStorePath), { recursive: true });
  await writeFile(marketplaceStorePath, JSON.stringify(marketplaceStore, null, 2));
}

function getInvoiceById(invoiceId) {
  return paymentStore.invoices.find((invoice) => invoice.id === invoiceId);
}

async function fetchAddressSummary(address) {
  const url = `${explorerBaseUrl}/${explorerNetworkPrefix}/dashboards/address/${address}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Explorer request failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  const record = payload?.data?.[address]?.address;

  if (!record) {
    throw new Error("Explorer did not return address data.");
  }

  return {
    receivedSatoshis: Number(record.received || 0),
    balanceSatoshis: Number(record.balance || 0),
    transactionCount: Number(record.transaction_count || 0)
  };
}

app.get(["/health", "/api/health"], (req, res) => {
  res.json({
    ok: true,
    network: networkName,
    paymentAddress: deriveAddress(0),
    derivationBasePath
  });
});

app.get("/api/wallet", (req, res) => {
  res.json({
    success: true,
    wallet: {
      network: networkName,
      receiveAddress: deriveAddress(0),
      derivationBasePath,
      explorerBaseUrl,
      explorerNetworkPrefix,
      note: "Create payment requests to generate unique receive addresses."
    }
  });
});

app.get("/api/invoices", (req, res) => {
  res.json({
    success: true,
    invoices: paymentStore.invoices
      .slice()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(serializeInvoice)
  });
});

app.get("/catalog", (req, res) => {
  res.json({
    success: true,
    items: marketplaceStore.items
      .slice()
      .sort((left, right) => Number(left.tokenId) - Number(right.tokenId))
  });
});

app.get("/history", (req, res) => {
  const user = typeof req.query.user === "string" ? req.query.user.trim().toLowerCase() : "";

  const listedItems = marketplaceStore.items
    .filter((item) => {
      if (!user) {
        return true;
      }

      const bagName = String(item.bagName || "").toLowerCase();
      const owner = String(item.owner || "").toLowerCase();
      const material = String(item.material || "").toLowerCase();

      return bagName.includes(user) || owner.includes(user) || material.includes(user) || String(item.tokenId).includes(user);
    })
    .map((item) => ({
      tokenId: item.tokenId,
      bagName: item.bagName,
      condition: item.condition,
      material: item.material,
      imageURI: item.imageURI,
      owner: item.owner,
      startBidEth: weiToDashString(item.metadata?.startBidWei || item.listing?.priceWei || "0"),
      startBidWei: item.metadata?.startBidWei || item.listing?.priceWei || "0",
      bidEndTime: item.metadata?.bidEndTime || null
    }));

  const latestListedItem = listedItems.length > 0 ? listedItems[listedItems.length - 1] : null;

  res.json({
    success: true,
    listedItems,
    bidItems: [],
    latestListedItem
  });
});

app.post("/upload-image", async (req, res) => {
  try {
    const imageData = typeof req.body?.imageData === "string" ? req.body.imageData.trim() : "";

    if (!imageData) {
      return res.status(400).json({ success: false, error: "imageData is required." });
    }

    const match = imageData.match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/i);
    if (!match) {
      return res.status(400).json({ success: false, error: "Unsupported image format." });
    }

    const extension = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
    const buffer = Buffer.from(match[2], "base64");

    if (buffer.length === 0) {
      return res.status(400).json({ success: false, error: "Image data is empty." });
    }

    if (buffer.length > 2 * 1024 * 1024) {
      return res.status(413).json({ success: false, error: "Image too large. Please upload a smaller file." });
    }

    await mkdir(uploadsDirPath, { recursive: true });

    const fileName = `${Date.now()}-${randomUUID()}.${extension}`;
    const filePath = path.join(uploadsDirPath, fileName);
    await writeFile(filePath, buffer);

    return res.status(201).json({
      success: true,
      imageURI: `/uploads/${fileName}`,
      fileName,
      sizeBytes: buffer.length
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Image upload failed."
    });
  }
});

app.post("/mint", async (req, res) => {
  try {
    const bagName = typeof req.body?.bagName === "string" ? req.body.bagName.trim() : "";
    const condition = typeof req.body?.condition === "string" ? req.body.condition.trim() : "";
    const material = typeof req.body?.material === "string" ? req.body.material.trim() : "";
    const imageURI = typeof req.body?.imageURI === "string" ? req.body.imageURI.trim() : "";
    const startBidInput = req.body?.startBid ?? "0";
    const bidEndTimeInput = typeof req.body?.bidEndTime === "string" ? req.body.bidEndTime.trim() : "";

    if (!bagName || !condition || !material) {
      return res.status(400).json({ success: false, error: "bagName, condition, and material are required." });
    }

    if (!imageURI) {
      return res.status(400).json({ success: false, error: "imageURI is required." });
    }

    const bidEndDate = new Date(bidEndTimeInput);
    if (!bidEndTimeInput || Number.isNaN(bidEndDate.getTime())) {
      return res.status(400).json({ success: false, error: "bidEndTime must be a valid ISO date string." });
    }

    const startBidWei = dashToWeiString(startBidInput);
    const tokenId = marketplaceStore.nextTokenId++;

    const item = {
      tokenId,
      bagName,
      condition,
      material,
      imageURI,
      owner: "Wallet managed",
      listing: {
        active: true,
        priceWei: startBidWei
      },
      metadata: {
        startBidWei,
        bidEndTime: Math.floor(bidEndDate.getTime() / 1000)
      }
    };

    marketplaceStore.items.push(item);
    await saveMarketplaceStore();

    return res.status(201).json({
      success: true,
      txHash: createTxHash(),
      tokenId: String(tokenId),
      blockNumber: tokenId + 1
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Mint request failed."
    });
  }
});

app.get("/read", (req, res) => {
  try {
    const tokenIdRaw = req.query.tokenId;
    const tokenId = Number(tokenIdRaw);

    if (!Number.isInteger(tokenId) || tokenId < 0) {
      return res.status(400).json({
        success: false,
        error: "tokenId must be a non-negative integer. Example: /read?tokenId=0"
      });
    }

    const item = marketplaceStore.items.find((entry) => Number(entry.tokenId) === tokenId);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: `Token ${tokenId} does not exist (not minted yet).`
      });
    }

    const startBidWei = item.metadata?.startBidWei || item.listing?.priceWei || "0";
    const bidEndTime = Number(item.metadata?.bidEndTime || 0);

    return res.json({
      success: true,
      tokenId,
      owner: item.owner || "Wallet managed",
      metadata: {
        bagName: item.bagName,
        condition: item.condition,
        material: item.material,
        imageURI: item.imageURI,
        startBidWei,
        startBidEth: weiToDashString(startBidWei),
        bidEndTime,
        bidEndTimeIso: bidEndTime ? new Date(bidEndTime * 1000).toISOString() : null
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Read request failed."
    });
  }
});

app.post("/api/invoices", async (req, res) => {
  try {
    const reference = typeof req.body?.reference === "string" ? req.body.reference.trim() : "";
    const memo = typeof req.body?.memo === "string" ? req.body.memo.trim() : "";
    const amountDash = Number(req.body?.amountDash);

    if (!Number.isFinite(amountDash) || amountDash <= 0) {
      return res.status(400).json({ success: false, error: "amountDash must be a positive number." });
    }

    const amountSatoshis = dashToSatoshis(amountDash);

    if (!Number.isInteger(amountSatoshis) || amountSatoshis <= 0) {
      return res.status(400).json({ success: false, error: "amountDash is too small." });
    }

    const index = paymentStore.nextInvoiceIndex++;
    const invoice = {
      id: randomUUID(),
      index,
      reference,
      memo,
      amountDash: Number(amountDash.toFixed(8)),
      amountSatoshis,
      paymentAddress: deriveAddress(index),
      network: networkName,
      status: "pending",
      createdAt: new Date().toISOString(),
      expiresAt: null,
      paidAt: null,
      lastVerifiedAt: null,
      receivedSatoshis: 0
    };

    paymentStore.invoices.push(invoice);
    await savePaymentStore();

    return res.status(201).json({
      success: true,
      invoice: serializeInvoice(invoice)
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to create invoice."
    });
  }
});

app.get("/api/invoices/:id", (req, res) => {
  const invoice = getInvoiceById(req.params.id);

  if (!invoice) {
    return res.status(404).json({ success: false, error: "Invoice not found." });
  }

  return res.json({
    success: true,
    invoice: serializeInvoice(invoice)
  });
});

app.get("/api/invoices/:id/verify", async (req, res) => {
  const invoice = getInvoiceById(req.params.id);

  if (!invoice) {
    return res.status(404).json({ success: false, error: "Invoice not found." });
  }

  try {
    const summary = await fetchAddressSummary(invoice.paymentAddress);
    invoice.receivedSatoshis = summary.receivedSatoshis;
    invoice.lastVerifiedAt = new Date().toISOString();

    if (summary.receivedSatoshis >= invoice.amountSatoshis) {
      invoice.status = "paid";

      if (!invoice.paidAt) {
        invoice.paidAt = new Date().toISOString();
      }
    }

    await savePaymentStore();

    return res.json({
      success: true,
      invoice: serializeInvoice(invoice),
      explorer: summary,
      paid: invoice.status === "paid"
    });
  } catch (error) {
    return res.status(502).json({
      success: false,
      error: error instanceof Error ? error.message : "Payment verification failed."
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use((error, req, res, next) => {
  if (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error."
    });
  }

  next();
});

app.listen(port, () => {
  console.log(`Dash wallet payment server running on http://localhost:${port}`);
  console.log(`Network: ${networkName}`);
  console.log(`Primary receive address: ${deriveAddress(0)}`);
});