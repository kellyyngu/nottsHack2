document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
    const tokenId = params.get("id");

    async function loadItem() {
      if (!tokenId) {
        document.getElementById("itemName").textContent = "No token selected";
        return;
      }

      try {
        const res = await fetch(`/read?tokenId=${encodeURIComponent(tokenId)}`);
        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to load item");
        }

        document.getElementById("itemName").textContent = data.metadata.bagName || "Untitled Bag";
        document.getElementById("metaTokenId").textContent = tokenId;
        document.getElementById("metaCondition").textContent = data.metadata.condition || "-";
        document.getElementById("metaMaterial").textContent = data.metadata.material || "-";
        document.getElementById("metaDashTxId").textContent = data.metadata.dashTxId || "-";
        document.getElementById("metaOwner").textContent = data.owner || "-";
      } catch (err) {
        document.getElementById("itemName").textContent = "Failed to load item";
        document.getElementById("itemIntro").textContent = err.message || String(err);
      }
    }

    loadItem();
});

document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const tokenId = params.get("id");

  if (!tokenId) {
    document.getElementById("itemName").textContent = "Invalid item";
    return;
  }

  try {
    const res = await fetch(`/read?tokenId=${tokenId}`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Failed to load item");
    }

    const { owner, metadata } = data;

    // ✅ SET IMAGE HERE
    const imageEl = document.getElementById("itemImage");
    if (metadata.imageURI && metadata.imageURI.trim() !== "") {
      imageEl.src = metadata.imageURI;
    }

    // TEXT FIELDS
    document.getElementById("itemName").textContent = metadata.bagName || "Untitled Bag";
    document.getElementById("metaTokenId").textContent = tokenId;
    document.getElementById("metaCondition").textContent = metadata.condition || "-";
    document.getElementById("metaMaterial").textContent = metadata.material || "-";
    document.getElementById("metaDashTxId").textContent = metadata.dashTxId || "-";
    document.getElementById("metaOwner").textContent = owner || "-";

  } catch (err) {
    console.error(err);
    document.getElementById("itemName").textContent = "Failed to load item";
  }
});