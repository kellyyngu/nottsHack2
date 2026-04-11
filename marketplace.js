let allItems = [];

async function loadCatalog() {
  try {
    const res = await fetch("/catalog");
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to load catalog");
    }

    allItems = data.items || [];
    renderItems(allItems);
  } catch (err) {
    console.error(err);
    document.getElementById("marketGrid").innerHTML = "";
    document.getElementById("emptyState").style.display = "block";
    document.getElementById("emptyState").textContent = "Failed to load marketplace.";
  }
}

function formatPrice(item) {
  if (item.listing && item.listing.active && item.listing.priceWei) {
    return `${item.listing.priceWei} wei`;
  }
  return "Not listed";
}

function renderItems(items) {
  const grid = document.getElementById("marketGrid");
  const empty = document.getElementById("emptyState");

  grid.innerHTML = "";

  if (!items.length) {
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "gallery-card";

    const imageSrc =
      item.imageURI && item.imageURI.trim() !== ""
        ? item.imageURI
        : "https://via.placeholder.com/420x420?text=Luxury+Bag";

    card.innerHTML = `
      <div class="gallery-meta">
        <div class="item-category">${item.condition || "Verified Item"}</div>
        <div class="item-header-row">
          <h3>${item.bagName || "Untitled Bag"}</h3>
          <span>${formatPrice(item)}</span>
        </div>
      </div>

      <a href="item.html?id=${item.tokenId}" class="item-card-link">
    <img src="${imageSrc}" alt="${item.bagName}" />

    <div class="gallery-meta">
      <h3>${item.bagName}</h3>
      <p>${item.condition} • ${item.material}</p>
    </div>
  </a>

      <div class="gallery-footer">
        <div class="item-tags">
          <span>${item.material || "Unknown Material"}</span>
          <span>#${item.tokenId}</span>
        </div>

        <div class="item-actions">
          <a href="item.html?id=${item.tokenId}" class="text-link">View</a>
        </div>
      </div>
    `;

    grid.appendChild(card);
  });
}


function applyFilters() {
  const search = document.getElementById("search").value.toLowerCase().trim();
  const condition = document.getElementById("conditionFilter").value;
  const material = document.getElementById("materialFilter").value;

  const filtered = allItems.filter((item) => {
    const name = (item.bagName || "").toLowerCase();
    const itemCondition = item.condition || "";
    const itemMaterial = item.material || "";

    const matchesSearch =
      name.includes(search) ||
      String(item.tokenId).includes(search) ||
      (item.owner || "").toLowerCase().includes(search);

    const matchesCondition = !condition || itemCondition === condition;
    const matchesMaterial = !material || itemMaterial === material;

    return matchesSearch && matchesCondition && matchesMaterial;
  });

  renderItems(filtered);
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("search").addEventListener("input", applyFilters);
  document.getElementById("conditionFilter").addEventListener("change", applyFilters);
  document.getElementById("materialFilter").addEventListener("change", applyFilters);
  document.getElementById("refreshBtn").addEventListener("click", loadCatalog);

  loadCatalog();
});