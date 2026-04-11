function setBidStatus(message, isError = false) {
  const el = document.getElementById("bidStatus");
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
  const highestEl = document.getElementById("highestBidText");
  const endEl = document.getElementById("listingEndText");
  const bidPanel = document.getElementById("bidPanel");

  if (!listing) {
    modeEl.textContent = "Not listed";
    priceEl.textContent = "-";
    highestEl.textContent = "-";
    endEl.textContent = "-";
    bidPanel.style.display = "none";
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

  highestEl.textContent = listing.highestBid
    ? `${listing.highestBid.amountDash} DASH (${listing.highestBid.walletId})`
    : "No bids yet";
  endEl.textContent = listing.endsAt || "-";
  bidPanel.style.display = listing.mode === "auction" ? "block" : "none";
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

  await loadItemAndListing();
});