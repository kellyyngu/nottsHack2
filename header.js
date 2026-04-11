document.addEventListener("DOMContentLoaded", () => {
  const accountIcon = document.getElementById("accountIcon");
  const cartIcon = document.getElementById("cartIcon");

  if (accountIcon) {
    accountIcon.addEventListener("click", () => {
      window.location.href = "wallet-activity.html";
    });
  }

  if (cartIcon) {
    cartIcon.addEventListener("click", () => {
      window.location.href = "marketplace.html";
    });
  }
});

document.querySelectorAll("a").forEach(a => {
  a.addEventListener("click", () => {
    document.body.style.opacity = 0.8;
    setTimeout(() => document.body.style.opacity = 1, 150);
  });
});