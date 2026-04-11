// simulate login state (later replace with real backend / wallet)
function isLoggedIn() {
  return localStorage.getItem("userLoggedIn") === "true";
}

document.addEventListener("DOMContentLoaded", () => {
  const accountIcon = document.getElementById("accountIcon");
  const cartIcon = document.getElementById("cartIcon");

  if (accountIcon) {
    accountIcon.addEventListener("click", () => {
      if (isLoggedIn()) {
        alert("Already signed in!");
        // later: redirect to profile page
      } else {
        window.location.href = "create-account.html";
      }
    });
  }

  if (cartIcon) {
    cartIcon.addEventListener("click", () => {
      if (isLoggedIn()) {
        window.location.href = "cart.html";
      } else {
        if (isLoggedIn()) {
        alert("Already signed in!");
        // later: redirect to profile page
      } else {
        window.location.href = "create-account.html";
      }}
    });
  }
});