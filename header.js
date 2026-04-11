document.addEventListener("DOMContentLoaded", () => {
  const accountIcon = document.getElementById("accountIcon");
  const cartIcon = document.getElementById("cartIcon");

  if (accountIcon) {
    accountIcon.addEventListener("click", () => {
      window.location.href = "mint.html";
    });
  }

  if (cartIcon) {
    cartIcon.addEventListener("click", () => {
      window.location.href = "marketplace.html";
    });
  }
});