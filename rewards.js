const rewardsWalletInput = document.getElementById("rewardsWalletInput");
const rewardsWalletBtn = document.getElementById("rewardsWalletBtn");
const rewardsStatus = document.getElementById("rewardsStatus");
const walletRewardDetails = document.getElementById("walletRewardDetails");
const rewardsLeaderboard = document.getElementById("rewardsLeaderboard");

function setRewardsStatus(message, isError = false) {
  rewardsStatus.textContent = message;
  rewardsStatus.className = isError ? "status-box err" : "status-box ok";
  rewardsStatus.style.display = "block";
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

function computeReward(transactionCount) {
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

function buildStatsFromTransactions(walletId, transactions) {
  const txs = Array.isArray(transactions) ? transactions : [];
  const transactionCount = txs.length;
  const listingCount = txs.filter((tx) => tx?.type === "listing_created").length;
  const bidCount = txs.filter((tx) => tx?.type === "bid_placed").length;

  return {
    walletId,
    transactionCount,
    listingCount,
    bidCount,
    reward: computeReward(transactionCount),
    lastActivityAt: txs.length ? txs[0]?.timestamp || null : null
  };
}

function formatReward(stats) {
  if (!stats) {
    return "No reward data.";
  }

  return [
    `wallet: ${stats.walletId || "-"}`,
    `transactions: ${stats.transactionCount || 0}`,
    `listings: ${stats.listingCount || 0}`,
    `bids: ${stats.bidCount || 0}`,
    `reward tier: ${stats.reward?.label || "No Reward"}`,
    `discount: ${stats.reward?.discountPercent || 0}%`,
    `benefit: ${stats.reward?.description || "-"}`,
    `last activity: ${stats.lastActivityAt || "-"}`
  ].join("\n");
}

async function loadRewardSummary() {
  try {
    let wallets = [];

    const res = await fetch("/wallet-rewards/summary");
    const data = await parseApiResponse(res);
    if (res.ok && data.success) {
      wallets = data.wallets || [];
    } else {
      const fallbackRes = await fetch("/wallet-activity/summary");
      const fallbackData = await parseApiResponse(fallbackRes);
      if (!fallbackRes.ok || !fallbackData.success) {
        throw new Error(fallbackData.error || data.error || "Failed to load rewards summary.");
      }

      wallets = (fallbackData.wallets || []).map((wallet) => {
        const transactionCount = Number(wallet.transactionCount || 0);
        return {
          walletId: wallet.walletId,
          transactionCount,
          listingCount: Number(wallet.listingCount || 0),
          bidCount: Number(wallet.bidCount || 0),
          reward: wallet.reward || computeReward(transactionCount),
          lastActivityAt: wallet.lastActivityAt || null
        };
      });
    }

    if (!wallets.length) {
      rewardsLeaderboard.textContent = "No wallet activity yet.";
      return;
    }

    rewardsLeaderboard.textContent = wallets
      .map((wallet) =>
        `${wallet.walletId} | tx: ${wallet.transactionCount} | listings: ${wallet.listingCount} | reward: ${wallet.reward?.label || "No Reward"}`
      )
      .join("\n");
  } catch (err) {
    rewardsLeaderboard.textContent = "Cannot load rewards leaderboard.";
    setRewardsStatus(err.message || String(err), true);
  }
}

async function loadWalletReward() {
  const walletId = String(rewardsWalletInput.value || "").trim();
  if (!walletId) {
    setRewardsStatus("Enter a wallet ID.", true);
    return;
  }

  rewardsWalletBtn.disabled = true;
  setRewardsStatus("Checking wallet reward...");

  try {
    let stats = null;

    const res = await fetch(`/wallet-rewards/${encodeURIComponent(walletId)}`);
    const data = await parseApiResponse(res);

    if (res.ok && data.success && data.stats) {
      stats = data.stats;
    } else {
      const fallbackRes = await fetch(`/wallet-activity/${encodeURIComponent(walletId)}`);
      const fallbackData = await parseApiResponse(fallbackRes);
      if (!fallbackRes.ok || !fallbackData.success) {
        throw new Error(fallbackData.error || data.error || "Failed to load wallet reward.");
      }
      stats = fallbackData.stats || buildStatsFromTransactions(walletId, fallbackData.transactions || []);
    }

    walletRewardDetails.textContent = formatReward(stats);
    setRewardsStatus(`Reward loaded for ${walletId}.`);
  } catch (err) {
    walletRewardDetails.textContent = "";
    setRewardsStatus(err.message || String(err), true);
  } finally {
    rewardsWalletBtn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  rewardsWalletBtn.addEventListener("click", loadWalletReward);
  rewardsWalletInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      loadWalletReward();
    }
  });

  loadRewardSummary();
});
