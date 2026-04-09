let items = [];

async function loadCatalog() {
  const data = await fetchCatalog();
  items = data.items || [];
  render(items);
}

function render(list) {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";

  list.forEach(item => {
    const div = document.createElement("div");
    div.className = "card";

    div.innerHTML = `
      <img src="${item.imageURI || 'https://via.placeholder.com/300'}" />
      <h3>${item.bagName}</h3>
      <p>${item.condition} • ${item.material}</p>
      <button onclick="view(${item.tokenId})">View</button>
    `;

    grid.appendChild(div);
  });
}

function view(id) {
  window.location.href = `item.html?id=${id}`;
}

document.getElementById("search").addEventListener("input", () => {
  const s = search.value.toLowerCase();
  render(items.filter(i => i.bagName.toLowerCase().includes(s)));
});

loadCatalog();