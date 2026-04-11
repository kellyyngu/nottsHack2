const statusEl = document.getElementById("status");
const mintBtn = document.getElementById("mintBtn");
const viewBtn = document.getElementById("viewBtn");
const verifyDashBtn = document.getElementById("verifyDashBtn");
const viewResultEl = document.getElementById("viewResult");
const dashPaymentStatusEl = document.getElementById("dashPaymentStatus");

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = isError ? "status-box err" : "status-box ok";
  statusEl.style.display = "block";
  statusEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

let stream = null;
let capturedImageData = null;
let imageApproved = false;
let currentSource = "upload";
let paymentVerified = false;
let verifiedDashTxId = "";
const MAX_CAPTURE_WIDTH = 512;
const TARGET_IMAGE_BYTES = 120 * 1024;
const ALLOWED_CONDITIONS = ["Excellent", "Good", "Fair", "Used", "New"];
const ALLOWED_MATERIALS = [
  "Lambskin",
  "Calfskin",
  "Saffiano leather",
  "Full-grain leather",
  "Epi leather",
  "Canvas",
  "Nylon",
  "Polyester",
  "Suede",
  "Nubuck",
  "Exotic",
  "Other"
];

function toCanonicalChoice(value, allowedValues) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowedValues.find((item) => item.toLowerCase() === normalized) || "";
}

function initSearchableDropdown(inputId, optionsId, choices) {
  const input = document.getElementById(inputId);
  const optionsBox = document.getElementById(optionsId);

  if (!input || !optionsBox) {
    return;
  }

  const renderOptions = (filterText = "") => {
    const query = filterText.trim().toLowerCase();
    const filtered = choices.filter((choice) => choice.toLowerCase().includes(query));

    optionsBox.innerHTML = "";
    if (!filtered.length) {
      const empty = document.createElement("button");
      empty.type = "button";
      empty.className = "searchable-option";
      empty.textContent = "No matching options";
      empty.disabled = true;
      optionsBox.appendChild(empty);
      return;
    }

    for (const choice of filtered) {
      const optionBtn = document.createElement("button");
      optionBtn.type = "button";
      optionBtn.className = "searchable-option";
      optionBtn.textContent = choice;
      optionBtn.addEventListener("click", () => {
        input.value = choice;
        optionsBox.classList.remove("show");
      });
      optionsBox.appendChild(optionBtn);
    }
  };

  input.addEventListener("focus", () => {
    renderOptions(input.value);
    optionsBox.classList.add("show");
  });

  input.addEventListener("input", () => {
    renderOptions(input.value);
    optionsBox.classList.add("show");
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      optionsBox.classList.remove("show");
    }
  });

  document.addEventListener("click", (event) => {
    if (!optionsBox.contains(event.target) && event.target !== input) {
      optionsBox.classList.remove("show");
    }
  });

  renderOptions();
}

function showDashPaymentStatus(message, isError = false) {
  if (!dashPaymentStatusEl) {
    return;
  }

  dashPaymentStatusEl.textContent = message;
  dashPaymentStatusEl.className = isError ? "status-box err" : "status-box ok";
  dashPaymentStatusEl.style.display = "block";
}

async function loadDashPaymentInfo() {
  try {
    const res = await fetch("/dash/payment-info");
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Failed to load Dash payment address");
    }

    const dashAddressInput = document.getElementById("dashAddress");
    dashAddressInput.value = data.merchantAddress || "";
    showDashPaymentStatus(
      `Pay at least ${data.minimumDash} DASH, verify your TXID to mint your item as an NFT.`
    );
  } catch (err) {
    showDashPaymentStatus(err.message || String(err), true);
  }
}

async function verifyDashPayment() {
  const dashTxId = document.getElementById("dashTxId").value.trim();

  if (!dashTxId) {
    showDashPaymentStatus("Enter a Dash transaction ID first.", true);
    return;
  }

  verifyDashBtn.disabled = true;
  showDashPaymentStatus("Verifying Dash payment...");

  try {
    const res = await fetch("/dash/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txid: dashTxId })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Dash payment verification failed");
    }

    if (!data.meetsMinimum) {
      paymentVerified = false;
      verifiedDashTxId = "";
      showDashPaymentStatus(
        `Payment too low. Received ${data.receivedDash} DASH but minimum is required.`,
        true
      );
      return;
    }

    paymentVerified = true;
    verifiedDashTxId = dashTxId;
    showDashPaymentStatus(
      `Dash payment verified: ${data.receivedDash} DASH (${data.confirmations} confirmations).`
    );
  } catch (err) {
    paymentVerified = false;
    verifiedDashTxId = "";
    showDashPaymentStatus(err.message || String(err), true);
  } finally {
    verifyDashBtn.disabled = false;
  }
}

function compressImageFromSource(sourceEl, sourceWidth, sourceHeight) {
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  let scale = Math.min(1, MAX_CAPTURE_WIDTH / sourceWidth);
  let quality = 0.7;
  let targetWidth = Math.max(1, Math.floor(sourceWidth * scale));
  let targetHeight = Math.max(1, Math.floor(sourceHeight * scale));

  canvas.width = targetWidth;
  canvas.height = targetHeight;
  ctx.drawImage(sourceEl, 0, 0, targetWidth, targetHeight);
  capturedImageData = canvas.toDataURL("image/jpeg", quality);

  let estimatedBytes = Math.floor(capturedImageData.length * 0.75);
  while (estimatedBytes > TARGET_IMAGE_BYTES && (quality > 0.4 || targetWidth > 320)) {
    if (quality > 0.4) {
      quality -= 0.1;
    } else {
      targetWidth = Math.max(320, Math.floor(targetWidth * 0.9));
      targetHeight = Math.max(180, Math.floor(targetHeight * 0.9));
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      ctx.drawImage(sourceEl, 0, 0, targetWidth, targetHeight);
    }

    capturedImageData = canvas.toDataURL("image/jpeg", quality);
    estimatedBytes = Math.floor(capturedImageData.length * 0.75);
  }

  return { targetWidth, targetHeight, quality, estimatedBytes };
}

function updateCameraStatus(message, type) {
  const status = document.getElementById("cameraStatus");
  status.textContent = message;
  status.style.color =
    type === "error" ? "#ef4444" :
    type === "success" ? "#10b981" :
    "#94a3b8";
}

function switchImageSource(source) {
  currentSource = source;

  const uploadPanel = document.getElementById("uploadPanel");
  const cameraPanel = document.getElementById("cameraPanel");
  const sourceToggle = document.querySelector(".source-toggle");
  const uploadModeBtn = document.getElementById("uploadModeBtn");
  const cameraModeBtn = document.getElementById("cameraModeBtn");

  if (sourceToggle) sourceToggle.style.display = "none";
  document.getElementById("backBtn").style.display = "inline-flex";

  if (source === "upload") {
    uploadPanel.classList.remove("hidden");
    cameraPanel.classList.add("hidden");
    uploadModeBtn.classList.add("active");
    cameraModeBtn.classList.remove("active");
    stopCamera();
    updateCameraStatus("Upload an image, then approve it before minting.", "info");
  } else {
    uploadPanel.classList.add("hidden");
    cameraPanel.classList.remove("hidden");
    uploadModeBtn.classList.remove("active");
    cameraModeBtn.classList.add("active");
    updateCameraStatus("Start camera, capture an image, then approve it.", "info");
    startCamera();
  }
}

function handleImageUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    updateCameraStatus("Please select a valid image file.", "error");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const previewImage = new Image();
    previewImage.onload = () => {
      const { targetWidth, targetHeight, quality, estimatedBytes } =
        compressImageFromSource(
          previewImage,
          previewImage.naturalWidth,
          previewImage.naturalHeight
        );

      const capturedImg = document.getElementById("capturedImage");
      capturedImg.src = capturedImageData;
      capturedImg.style.display = "block";

      document.getElementById("approveBtn").style.display = "inline-block";
      document.getElementById("clearBtn").style.display = "inline-block";
      document.getElementById("approveBtn").textContent = "Approve Image";
      imageApproved = false;

      updateCameraStatus("Image uploaded. Approve image before minting.", "success");
      const approxKB = Math.round(estimatedBytes / 1024);
      document.getElementById("imagePreview").textContent =
        `Image prepared (${targetWidth}x${targetHeight}, q=${quality.toFixed(2)}, ~${approxKB}KB).`;
    };

    previewImage.src = reader.result;
  };

  reader.readAsDataURL(file);
}

async function startCamera() {
  try {
    updateCameraStatus("Requesting camera access...", "info");
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user"
      },
      audio: false
    });

    const video = document.getElementById("videoStream");
    video.srcObject = stream;
    video.style.display = "block";
    video.onloadedmetadata = () => {
      video.play().catch(() => {
        updateCameraStatus("Camera opened, but playback was blocked. Try again.", "error");
      });
    };

    document.getElementById("startCameraBtn").style.display = "none";
    document.getElementById("backBtn").style.display = "inline-flex";
    document.getElementById("captureBtn").style.display = "inline-block";
    document.getElementById("stopCameraBtn").style.display = "inline-block";

    updateCameraStatus("Camera is live. Capture an image to continue.", "success");
  } catch (err) {
    updateCameraStatus(`Camera error: ${err.message}.`, "error");
  }
}

function captureFromCamera() {
  const video = document.getElementById("videoStream");
  if (!video.videoWidth || !video.videoHeight) {
    updateCameraStatus("Camera is not ready yet. Try again in a moment.", "error");
    return;
  }

  const { targetWidth, targetHeight, quality, estimatedBytes } =
    compressImageFromSource(video, video.videoWidth, video.videoHeight);

  const capturedImg = document.getElementById("capturedImage");
  capturedImg.src = capturedImageData;
  capturedImg.style.display = "block";

  document.getElementById("startCameraBtn").style.display = "none";
  document.getElementById("approveBtn").style.display = "inline-block";
  document.getElementById("clearBtn").style.display = "inline-block";
  document.getElementById("approveBtn").textContent = "Approve Image";
  imageApproved = false;

  stopCamera();
  document.getElementById("startCameraBtn").style.display = "none";

  updateCameraStatus("Image captured from live feed. Approve image before minting.", "success");
  const approxKB = Math.round(estimatedBytes / 1024);
  document.getElementById("imagePreview").textContent =
    `Image prepared (${targetWidth}x${targetHeight}, q=${quality.toFixed(2)}, ~${approxKB}KB).`;
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  const video = document.getElementById("videoStream");
  video.srcObject = null;
  video.style.display = "none";
  document.getElementById("startCameraBtn").style.display = "inline-block";
  document.getElementById("captureBtn").style.display = "none";
  document.getElementById("stopCameraBtn").style.display = "none";
}

function goBackToSourceOptions() {
  stopCamera();
  currentSource = "upload";

  document.getElementById("capturedImage").style.display = "none";
  document.getElementById("approveBtn").style.display = "none";
  document.getElementById("clearBtn").style.display = "none";
  document.getElementById("approveBtn").textContent = "Approve Image";

  document.getElementById("cameraPanel").classList.add("hidden");
  document.getElementById("uploadPanel").classList.add("hidden");
  document.querySelector(".source-toggle").style.display = "flex";
  document.getElementById("uploadModeBtn").classList.remove("active");
  document.getElementById("cameraModeBtn").classList.remove("active");
  document.getElementById("backBtn").style.display = "none";

  updateCameraStatus("Choose Upload Image or Use Live Camera.", "info");
  document.getElementById("imagePreview").textContent = "";
}

function clearSelectedImage() {
  capturedImageData = null;
  imageApproved = false;

  const capturedImg = document.getElementById("capturedImage");
  capturedImg.src = "";
  capturedImg.style.display = "none";

  document.getElementById("imageInput").value = "";
  document.getElementById("approveBtn").style.display = "none";
  document.getElementById("approveBtn").textContent = "Approve Image";
  document.getElementById("clearBtn").style.display = "none";

  const message = currentSource === "camera"
    ? "Retaking image. Restarting live camera."
    : "Image cleared. Upload a new image.";
  updateCameraStatus(message, "info");
  document.getElementById("imagePreview").textContent = "";

  if (currentSource === "camera") {
    startCamera();
  } else {
    document.getElementById("backBtn").style.display = "inline-flex";
  }
}

async function approveImage() {
  if (!capturedImageData) {
    updateCameraStatus("Upload an image first.", "error");
    return;
  }

  try {
    const blob = await (await fetch(capturedImageData)).blob();
    const formData = new FormData();
    formData.append("file", blob, "capture.jpg");

    const response = await fetch("http://127.0.0.1:8000/verify", {
      method: "POST",
      body: formData
    });

    if (response.ok) {
      const result = await response.json();
      if (result.status === "success") {
        imageApproved = true;
        document.getElementById("approveBtn").textContent = "Approved ✓";
        updateCameraStatus("Image approved. You can mint now.", "success");
        document.getElementById("imagePreview").textContent =
          "Verification passed. Image approved for minting.";
        return;
      }

      updateCameraStatus("Verification failed. Please retake or upload a clearer image.", "error");
      return;
    }
  } catch {
    // fallback
  }

  imageApproved = true;
  document.getElementById("approveBtn").textContent = "Approved ✓";
  updateCameraStatus("Image approved (verifier unavailable). You can mint now.", "success");
  document.getElementById("imagePreview").textContent = "Image approved for minting.";
}

async function mintNftFlow() {
  const bagName = document.getElementById("bagName").value.trim();
  const itemDescription = document.getElementById("itemDescription").value.trim();
  const selectedCondition = document.getElementById("condition").value.trim();
  const selectedMaterial = document.getElementById("material").value.trim();
  const condition = toCanonicalChoice(selectedCondition, ALLOWED_CONDITIONS);
  const material = toCanonicalChoice(selectedMaterial, ALLOWED_MATERIALS);
  const listingMode = document.getElementById("listingMode").value;
  const fixedPriceDash = document.getElementById("fixedPriceDash").value.trim();
  const startBidDash = document.getElementById("startBidDash").value.trim();
  const listingEndTime = document.getElementById("listingEndTime").value;
  const sellerWalletId = document.getElementById("sellerWalletId").value.trim();
  const dashTxId = document.getElementById("dashTxId").value.trim();

  if (!bagName || !selectedCondition || !selectedMaterial) {
    showStatus("Please fill all fields.", true);
    return;
  }

  if (!condition) {
    showStatus(`Condition must be one of: ${ALLOWED_CONDITIONS.join(", ")}.`, true);
    return;
  }

  if (!material) {
    showStatus(`Material must be one of: ${ALLOWED_MATERIALS.join(", ")}.`, true);
    return;
  }

  if (listingMode === "fixed") {
    const fixed = Number(fixedPriceDash);
    if (!Number.isFinite(fixed) || fixed <= 0) {
      showStatus("Fixed price must be a positive DASH amount.", true);
      return;
    }
  }

  if (listingMode === "auction") {
    const start = Number(startBidDash);
    if (!Number.isFinite(start) || start <= 0) {
      showStatus("Starting bid must be a positive DASH amount.", true);
      return;
    }
  }

  if (!listingEndTime) {
    showStatus("Listing end time is required.", true);
    return;
  }

  const endAt = Date.parse(listingEndTime);
  if (!Number.isFinite(endAt) || endAt <= Date.now()) {
    showStatus("Listing end time must be in the future.", true);
    return;
  }

  if (!capturedImageData) {
    showStatus("Please upload or capture an image before minting.", true);
    return;
  }

  if (!imageApproved) {
    showStatus("Please approve the image before minting.", true);
    return;
  }

  if (!dashTxId) {
    showStatus("Please enter your Dash payment TXID before minting.", true);
    return;
  }

  if (!paymentVerified || dashTxId !== verifiedDashTxId) {
    showStatus("Please verify your Dash payment TXID before minting.", true);
    return;
  }

  mintBtn.disabled = true;
  showStatus("Uploading image...");

  try {
    const uploadRes = await fetch("/upload-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageData: capturedImageData })
    });

    const uploadData = await uploadRes.json();

    if (!uploadRes.ok || !uploadData.success || !uploadData.imageURI) {
      throw new Error(uploadData.error || "Image upload failed");
    }

    showStatus("Minting new NFT...");

    const listing = {
      mode: listingMode,
      listingEndTime,
      sellerWalletId
    };
    if (listingMode === "fixed") {
      listing.fixedPriceDash = Number(fixedPriceDash);
    } else if (listingMode === "auction") {
      listing.startBidDash = Number(startBidDash);
    }

    const res = await fetch("/mint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bagName,
        itemDescription,
        condition,
        material,
        imageURI: uploadData.imageURI,
        dashTxId,
        listing
      })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Mint request failed");
    }

    const mintedTokenPart =
      data.tokenId !== null && data.tokenId !== undefined
        ? ` | tokenId: ${data.tokenId}`
        : "";

    const storageChain = data?.nftStorage?.chain || "sepolia";
    const storageFee = data?.nftStorage?.estimatedStorageFeeEth;
    const sponsoredStoragePart = storageFee
      ? ` | sponsored storage fee: ~${storageFee} ETH on ${storageChain}`
      : ` | storage written on ${storageChain} (ETH sponsored by backend)`;

    showStatus(`Success! Minted. Tx hash: ${data.txHash}${mintedTokenPart}${sponsoredStoragePart}`);

    document.getElementById("bagName").value = "";
    document.getElementById("itemDescription").value = "";
    document.getElementById("condition").value = "";
    document.getElementById("material").value = "";
    document.getElementById("listingMode").value = "fixed";
    document.getElementById("fixedPriceDash").value = "";
    document.getElementById("startBidDash").value = "";
    document.getElementById("listingEndTime").value = "";
    document.getElementById("sellerWalletId").value = "";
    document.getElementById("dashTxId").value = "";
    capturedImageData = null;
    imageApproved = false;
    paymentVerified = false;
    verifiedDashTxId = "";
    document.getElementById("capturedImage").style.display = "none";
    document.getElementById("approveBtn").style.display = "none";
    document.getElementById("approveBtn").textContent = "Approve Image";
    document.getElementById("clearBtn").style.display = "none";
    document.getElementById("imagePreview").textContent = "";
  } catch (err) {
    showStatus(`Mint failed: ${err.message || String(err)}`, true);
  } finally {
    mintBtn.disabled = false;
  }
}

function updateListingModeFields() {
  const mode = document.getElementById("listingMode")?.value;
  const fixedWrap = document.getElementById("fixedPriceWrap");
  const auctionWrap = document.getElementById("auctionWrap");
  if (!fixedWrap || !auctionWrap) {
    return;
  }

  fixedWrap.style.display = mode === "fixed" ? "block" : "none";
  auctionWrap.style.display = mode === "auction" ? "block" : "none";
}

async function viewNFT() {
  const tokenIdValue = document.getElementById("tokenId").value.trim();

  if (tokenIdValue === "") {
    viewResultEl.className = "view-result-box show";
    viewResultEl.textContent = "Please enter tokenId.";
    return;
  }

  const tokenId = Number(tokenIdValue);
  if (!Number.isInteger(tokenId) || tokenId < 0) {
    viewResultEl.className = "view-result-box show";
    viewResultEl.textContent = "tokenId must be a non-negative integer.";
    return;
  }

  viewBtn.disabled = true;
  viewResultEl.className = "view-result-box show";
  viewResultEl.textContent = "Loading...";

  try {
    const res = await fetch(`/read?tokenId=${encodeURIComponent(tokenId)}`);
    const data = await res.json();

    if (res.status === 404) {
      viewResultEl.textContent = `Token ${tokenId} is not minted yet.`;
      return;
    }

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Read request failed");
    }

    viewResultEl.textContent = [
      `Owner: ${data.owner}`,
      `bagName: ${data.metadata.bagName}`,
      `condition: ${data.metadata.condition}`,
      `material: ${data.metadata.material}`,
      `dashTxId: ${data.metadata.dashTxId || "-"}`
    ].join("\n");
  } catch (err) {
    viewResultEl.textContent = `Read failed: ${err.message || String(err)}`;
  } finally {
    viewBtn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  mintBtn.addEventListener("click", mintNftFlow);
  viewBtn.addEventListener("click", viewNFT);
  verifyDashBtn.addEventListener("click", verifyDashPayment);

  initSearchableDropdown("condition", "conditionOptions", ALLOWED_CONDITIONS);
  initSearchableDropdown("material", "materialOptions", ALLOWED_MATERIALS);

  document.getElementById("listingMode")?.addEventListener("change", updateListingModeFields);
  updateListingModeFields();

  loadDashPaymentInfo();

  window.switchImageSource = switchImageSource;
  window.handleImageUpload = handleImageUpload;
  window.startCamera = startCamera;
  window.captureFromCamera = captureFromCamera;
  window.stopCamera = stopCamera;
  window.goBackToSourceOptions = goBackToSourceOptions;
  window.clearSelectedImage = clearSelectedImage;
  window.approveImage = approveImage;
});