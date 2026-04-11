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
    const res = await fetch("/wallet-rewards/summary");
    const data = await parseApiResponse(res);

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Failed to load rewards summary.");
    }

    const wallets = data.wallets || [];
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
    const res = await fetch(`/wallet-rewards/${encodeURIComponent(walletId)}`);
    const data = await parseApiResponse(res);

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Failed to load wallet reward.");
    }

    walletRewardDetails.textContent = formatReward(data.stats);
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
