const walletSearchInput = document.getElementById("walletSearchInput");
const walletSearchBtn = document.getElementById("walletSearchBtn");
const walletSearchStatus = document.getElementById("walletSearchStatus");
const walletSummaryEl = document.getElementById("walletSummary");
const walletTransactionsEl = document.getElementById("walletTransactions");
const transferSenderWalletIdEl = document.getElementById("transferSenderWalletId");
const transferRecipientIdEl = document.getElementById("transferRecipientId");
const transferAmountCreditsEl = document.getElementById("transferAmountCredits");
const transferIdentityIndexEl = document.getElementById("transferIdentityIndex");
const transferIdentityBtn = document.getElementById("transferIdentityBtn");
const transferStatusEl = document.getElementById("transferStatus");

function setStatus(message, isError = false) {
  walletSearchStatus.textContent = message;
  walletSearchStatus.className = isError ? "status-box err" : "status-box ok";
  walletSearchStatus.style.display = "block";
}

function setTransferStatus(message, isError = false) {
  if (!transferStatusEl) {
    return;
  }

  transferStatusEl.textContent = message;
  transferStatusEl.className = isError ? "status-box err" : "status-box ok";
  transferStatusEl.style.display = "block";
}

async function parseApiResponse(res) {
  const contentType = String(res.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    return await res.json();
  }

  const text = await res.text();
  return {
    success: false,
    error: text || `Request failed with status ${res.status}`
  };
}

function formatTransaction(tx) {
  const base = [`${tx.timestamp || "-"} | ${tx.type || "activity"}`];
  if (tx.tokenId !== undefined && tx.tokenId !== null) {
    base.push(`token #${tx.tokenId}`);
  }
  if (tx.amountDash !== undefined && tx.amountDash !== null) {
    base.push(`${tx.amountDash} DASH`);
  }
  if (tx.listingMode) {
    base.push(`mode=${tx.listingMode}`);
  }
  if (tx.bagName) {
    base.push(`item=${tx.bagName}`);
  }
  if (tx.endsAt) {
    base.push(`ends=${tx.endsAt}`);
  }
  return base.join(" | ");
}

async function loadSummary() {
  try {
    const res = await fetch("/wallet-activity/summary");
    const data = await parseApiResponse(res);
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Failed to load wallet summary.");
    }

    const wallets = data.wallets || [];
    if (!wallets.length) {
      walletSummaryEl.textContent = "No wallet activity yet.";
      return;
    }

    walletSummaryEl.textContent = wallets
      .map((w) => `${w.walletId} | transactions: ${w.transactionCount} | listings: ${w.listingCount || 0} | reward: ${w.reward?.label || "No Reward"} | last: ${w.lastActivityAt || "-"}`)
      .join("\n");
  } catch (err) {
    walletSummaryEl.textContent = "Cannot get wallet summary.";
    setStatus(`${err.message || String(err)} Make sure backend is running via: node server.js`, true);
  }
}

async function loadWalletTransactions() {
  const walletId = String(walletSearchInput.value || "").trim();
  if (!walletId) {
    setStatus("Enter a wallet ID.", true);
    return;
  }

  walletSearchBtn.disabled = true;
  setStatus("Loading wallet activity...");

  try {
    const res = await fetch(`/wallet-activity/${encodeURIComponent(walletId)}`);
    const data = await parseApiResponse(res);

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Failed to load wallet transactions.");
    }

    const transactions = data.transactions || [];
    if (!transactions.length) {
      walletTransactionsEl.textContent = `No transactions found for ${walletId}.`;
    } else {
      walletTransactionsEl.textContent = transactions.map(formatTransaction).join("\n");
    }

    setStatus(`Loaded ${transactions.length} transaction(s) for ${walletId}.`);
  } catch (err) {
    walletTransactionsEl.textContent = "";
    setStatus(err.message || String(err), true);
  } finally {
    walletSearchBtn.disabled = false;
  }
}

async function sendIdentityTransfer() {
  if (!transferIdentityBtn) {
    return;
  }

  const recipientId = String(transferRecipientIdEl?.value || "").trim();
  const amountCredits = Number(transferAmountCreditsEl?.value || "");
  const identityIndex = Number(transferIdentityIndexEl?.value || 0);
  const senderWalletId = String(transferSenderWalletIdEl?.value || "").trim();

  if (!recipientId) {
    setTransferStatus("Recipient identity ID is required.", true);
    return;
  }

  if (!Number.isInteger(amountCredits) || amountCredits <= 0) {
    setTransferStatus("Amount must be a positive integer number of credits.", true);
    return;
  }

  if (!Number.isInteger(identityIndex) || identityIndex < 0) {
    setTransferStatus("Identity index must be 0 or greater.", true);
    return;
  }

  transferIdentityBtn.disabled = true;
  setTransferStatus("Submitting identity transfer...");

  try {
    const res = await fetch("/dash/identity-transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientId,
        amountCredits,
        identityIndex,
        senderWalletId
      })
    });

    const data = await parseApiResponse(res);
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Identity transfer failed.");
    }

    const sender = data.senderIdentityId || "-";
    const resultId = data.resultId || "submitted";
    setTransferStatus(
      `Transfer sent: ${amountCredits} credits from ${sender} to ${recipientId}. Result: ${resultId}`
    );

    loadSummary();
    if (walletSearchInput && walletSearchInput.value.trim()) {
      loadWalletTransactions();
    }
  } catch (err) {
    setTransferStatus(err.message || String(err), true);
  } finally {
    transferIdentityBtn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  walletSearchBtn.addEventListener("click", loadWalletTransactions);
  walletSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      loadWalletTransactions();
    }
  });

  loadSummary();

  if (transferIdentityBtn) {
    transferIdentityBtn.addEventListener("click", sendIdentityTransfer);
  }
});
