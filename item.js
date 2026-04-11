function setBidStatus(message, isError = false) {
  const el = document.getElementById("bidStatus");
  if (!el) {
    return;
  }

  el.textContent = message;
  el.className = isError ? "status-box err" : "status-box ok";
  el.style.display = "block";
}

function setBuyStatus(message, isError = false) {
  const el = document.getElementById("buyStatus");
  if (!el) {
    return;
  }

  el.textContent = message;
  el.className = isError ? "status-box err" : "status-box ok";
  el.style.display = "block";
}

function renderListing(listing) {
  const modeEl = document.getElementById("listingModeText");
  const priceEl = document.getElementById("listingPriceText");
  const highestRowEl = document.getElementById("highestBidRow");
  const highestEl = document.getElementById("highestBidText");
  const endEl = document.getElementById("listingEndText");
  const bidPanel = document.getElementById("bidPanel");
  const buyPanel = document.getElementById("buyPanel");

  if (!listing) {
    modeEl.textContent = "Not listed";
    priceEl.textContent = "-";
    highestEl.textContent = "-";
    if (highestRowEl) highestRowEl.style.display = "none";
    endEl.textContent = "-";
    bidPanel.style.display = "none";
    if (buyPanel) buyPanel.style.display = "none";
    return;
  }

  modeEl.textContent = listing.mode;
  if (listing.mode === "fixed") {
    priceEl.textContent = `${listing.fixedPriceDash} DASH`;
  } else if (listing.mode === "auction") {
    priceEl.textContent = `${listing.startBidDash} DASH`;
  } else {
    priceEl.textContent = "Free donation";
  }

  if (listing.mode === "auction") {
    if (highestRowEl) highestRowEl.style.display = "flex";
    highestEl.textContent = listing.highestBid
      ? `${listing.highestBid.amountDash} DASH (${listing.highestBid.walletId})`
      : "No bids yet";
  } else {
    if (highestRowEl) highestRowEl.style.display = "none";
    highestEl.textContent = "-";
  }
  endEl.textContent = listing.endsAt || "-";
  bidPanel.style.display = listing.mode === "auction" ? "block" : "none";
  if (buyPanel) {
    buyPanel.style.display = listing.mode === "fixed" || listing.mode === "donate" ? "block" : "none";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const tokenId = params.get("id");

  if (!tokenId) {
    document.getElementById("itemName").textContent = "Invalid item";
    return;
  }

  async function loadItemAndListing() {
    try {
      const res = await fetch(`/read?tokenId=${encodeURIComponent(tokenId)}`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to load item");
      }

      const { owner, metadata, listing } = data;

      const imageEl = document.getElementById("itemImage");
      if (metadata.imageURI && metadata.imageURI.trim() !== "") {
        imageEl.src = metadata.imageURI;
      }

      document.getElementById("itemName").textContent = metadata.bagName || "Untitled Bag";
      document.getElementById("itemIntro").textContent = metadata.itemDescription ||
        "A digital passport view for your NFT-backed luxury item.";
      document.getElementById("metaTokenId").textContent = tokenId;
      document.getElementById("metaCondition").textContent = metadata.condition || "-";
      document.getElementById("metaMaterial").textContent = metadata.material || "-";
      document.getElementById("metaDashTxId").textContent = metadata.dashTxId || "-";
      document.getElementById("metaOwner").textContent = owner || "-";
      renderListing(listing || null);
    } catch (err) {
      document.getElementById("itemName").textContent = "Failed to load item";
      document.getElementById("itemIntro").textContent = err.message || String(err);
      renderListing(null);
    }
  }

  document.getElementById("placeBidBtn")?.addEventListener("click", async () => {
    const walletId = String(document.getElementById("bidWalletId")?.value || "").trim();
    const amountRaw = String(document.getElementById("bidAmountDash")?.value || "").trim();
    const amountDash = Number(amountRaw);

    if (!walletId) {
      setBidStatus("Wallet ID is required.", true);
      return;
    }

    if (!Number.isFinite(amountDash) || amountDash <= 0) {
      setBidStatus("Bid amount must be a positive DASH value.", true);
      return;
    }

    try {
      const res = await fetch(`/listing/${encodeURIComponent(tokenId)}/bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletId, amountDash })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to place bid.");
      }

      setBidStatus(`Bid submitted: ${amountDash} DASH by ${walletId}`);
      document.getElementById("bidAmountDash").value = "";
      renderListing(data.listing || null);
    } catch (err) {
      setBidStatus(err.message || String(err), true);
    }
  });

  document.getElementById("buyItemBtn")?.addEventListener("click", async () => {
    const buyerWalletId = String(document.getElementById("buyWalletId")?.value || "").trim();
    const dashTxId = String(document.getElementById("buyDashTxId")?.value || "").trim();
    const identityIndex = Number(document.getElementById("buyIdentityIndex")?.value || 0);

    if (!buyerWalletId) {
      setBuyStatus("Buyer wallet ID is required.", true);
      return;
    }

    if (!/^[a-fA-F0-9]{64}$/.test(dashTxId)) {
      setBuyStatus("Valid DASH payment TXID is required.", true);
      return;
    }

    if (!Number.isInteger(identityIndex) || identityIndex < 0) {
      setBuyStatus("Identity index must be 0 or greater.", true);
      return;
    }

    try {
      const res = await fetch(`/listing/${encodeURIComponent(tokenId)}/buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyerWalletId, dashTxId, identityIndex })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to buy item.");
      }

      const transferMessage = data?.identityTransfer?.attempted
        ? data.identityTransfer.success
          ? " Identity transfer completed."
          : ` Identity transfer failed: ${data.identityTransfer.error || "unknown error"}.`
        : "";

      setBuyStatus(`Purchase completed for token #${tokenId}.${transferMessage}`,
        Boolean(data?.identityTransfer?.attempted && !data.identityTransfer.success)
      );
      document.getElementById("buyDashTxId").value = "";
      await loadItemAndListing();
    } catch (err) {
      setBuyStatus(err.message || String(err), true);
    }
  });

  await loadItemAndListing();
});