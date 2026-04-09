async function fetchCatalog() {
  const res = await fetch("/catalog");
  return await res.json();
}