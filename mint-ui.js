const statusEl = document.getElementById("status");
const mintBtn = document.getElementById("mintBtn");
const viewBtn = document.getElementById("viewBtn");
const verifyDashBtn = document.getElementById("verifyDashBtn");
const copyChallengeBtn = document.getElementById("copyChallengeBtn");
const viewResultEl = document.getElementById("viewResult");
const dashPaymentStatusEl = document.getElementById("dashPaymentStatus");
const API_ORIGIN = String(window.API_BASE_URL || "").trim() || `${window.location.protocol}//${window.location.hostname}:3001`;

function apiUrl(path) {
  return `${API_ORIGIN}${path}`;
}

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
let verifiedTransferSessionToken = "";
let pendingTransferChallenge = null;
let liveAutoVerifyEnabled = false;
let liveVerifyAttempt = 0;
let liveVerifyBusy = false;
const MAX_CAPTURE_WIDTH = 512;
const TARGET_IMAGE_BYTES = 120 * 1024;
const VERIFY_CAPTURE_MAX_WIDTH = 960;
const VERIFY_CAPTURE_QUALITY = 0.92;
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

function invalidateTransferVerification() {
  paymentVerified = false;
  verifiedTransferSessionToken = "";
  pendingTransferChallenge = null;
}

async function copyAuthChallengeMessage() {
  const authChallengeMessageEl = document.getElementById("authChallengeMessage");
  const message = String(authChallengeMessageEl?.value || "").trim();

  if (!message) {
    showDashPaymentStatus("Create a challenge first before copying it.", true);
    return;
  }

  await navigator.clipboard.writeText(message);
  showDashPaymentStatus("Challenge message copied. Sign it with the auth key address shown in the form.");
}

async function loadDashPaymentInfo() {
  try {
    const res = await fetch(apiUrl("/dash/payment-info"));
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Failed to load Dash payment address");
    }

    const dashAddressInput = document.getElementById("dashAddress");
    dashAddressInput.value = data.merchantIdentityId || data.merchantAddress || "";
    const transferCreditsInput = document.getElementById("transferCredits");
    if (transferCreditsInput && !transferCreditsInput.value) {
      transferCreditsInput.value = String(data.minimumTransferCredits || "");
    }
    showDashPaymentStatus(
      `Transfer at least ${data.minimumTransferCredits} Platform credits to merchant identity, then verify before minting.`
    );
  } catch (err) {
    showDashPaymentStatus(err.message || String(err), true);
  }
}

async function verifyDashPayment() {
  const minterIdentityId = document.getElementById("minterIdentityId")?.value.trim() || "";
  const authAddress = document.getElementById("authAddress")?.value.trim() || "";
  const authSignature = document.getElementById("authSignature")?.value.trim() || "";
  const authChallengeMessageEl = document.getElementById("authChallengeMessage");
  const transferCreditsRaw = document.getElementById("transferCredits")?.value.trim() || "";
  const transferIdentityIndexRaw = document.getElementById("transferIdentityIndex")?.value.trim() || "0";
  const amountCredits = Number(transferCreditsRaw);
  const identityIndex = Number(transferIdentityIndexRaw);

  if (!minterIdentityId) {
    showDashPaymentStatus("Enter the minter identity ID first.", true);
    return;
  }

  if (!authAddress) {
    showDashPaymentStatus("Enter the auth key address before verification.", true);
    return;
  }

  if (!Number.isInteger(amountCredits) || amountCredits <= 0) {
    showDashPaymentStatus("Transfer credits must be a positive integer.", true);
    return;
  }

  if (!Number.isInteger(identityIndex) || identityIndex < 0) {
    showDashPaymentStatus("Identity index must be a non-negative integer.", true);
    return;
  }

  verifyDashBtn.disabled = true;
  showDashPaymentStatus("Creating secure verification challenge...");

  try {
    const needsNewChallenge =
      !pendingTransferChallenge ||
      pendingTransferChallenge.minterIdentityId !== minterIdentityId ||
      pendingTransferChallenge.amountCredits !== amountCredits ||
      pendingTransferChallenge.identityIndex !== identityIndex ||
      pendingTransferChallenge.authAddress.toLowerCase() !== authAddress.toLowerCase() ||
      Date.parse(pendingTransferChallenge.expiresAt || "") <= Date.now();

    if (needsNewChallenge) {
      const challengeRes = await fetch(apiUrl("/dash/identity-transfer/challenge"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minterIdentityId,
          amountCredits,
          identityIndex,
          authAddress,
          senderWalletId: minterIdentityId
        })
      });

      const challengeData = await challengeRes.json();
      if (!challengeRes.ok || !challengeData.success || !challengeData.challengeId) {
        throw new Error(challengeData.error || "Unable to create transfer challenge");
      }

      pendingTransferChallenge = {
        challengeId: challengeData.challengeId,
        expiresAt: challengeData.expiresAt,
        authMessage: challengeData.authMessage || "",
        minterIdentityId,
        amountCredits,
        identityIndex,
        authAddress
      };

      if (authChallengeMessageEl) {
        authChallengeMessageEl.value = pendingTransferChallenge.authMessage || "";
      }
    }

    if (!authSignature) {
      showDashPaymentStatus("Sign the challenge message and paste your auth key signature before verifying.", true);
      return;
    }

    showDashPaymentStatus("Verifying identity transfer with merchant...");

    const res = await fetch(apiUrl("/dash/verify-payment"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeId: pendingTransferChallenge.challengeId,
        minterIdentityId,
        amountCredits,
        identityIndex,
        authAddress,
        authSignature,
        senderWalletId: minterIdentityId
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Identity transfer verification failed");
    }

    if (!data.transferSessionToken) {
      throw new Error("Verification succeeded but no transfer session token was returned.");
    }

    paymentVerified = true;
    verifiedTransferSessionToken = data.transferSessionToken;
    pendingTransferChallenge = null;
    if (authChallengeMessageEl) {
      authChallengeMessageEl.value = "";
    }
    const transferMessage = data?.identityTransfer?.attempted
      ? data.identityTransfer.success
        ? " Identity transfer completed."
        : ` Identity transfer failed: ${data.identityTransfer.error || "unknown error"}.`
      : "";

    showDashPaymentStatus(
      `Identity transfer verified for ${amountCredits} credits with auth signature.${transferMessage}`,
      Boolean(data?.identityTransfer?.attempted && !data.identityTransfer.success)
    );
  } catch (err) {
    invalidateTransferVerification();
    showDashPaymentStatus(err.message || String(err), true);
  } finally {
    verifyDashBtn.disabled = false;
  }
}

function captureImageDataFromSource(sourceEl, sourceWidth, sourceHeight, options = {}) {
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const maxWidth = Number(options.maxWidth || MAX_CAPTURE_WIDTH);
  const initialQuality = Number(options.initialQuality || 0.7);
  const targetBytes = Number.isFinite(options.targetBytes) ? options.targetBytes : null;
  const minWidth = Number(options.minWidth || 320);
  const minHeight = Number(options.minHeight || 180);

  let scale = Math.min(1, maxWidth / sourceWidth);
  let quality = initialQuality;
  let targetWidth = Math.max(1, Math.floor(sourceWidth * scale));
  let targetHeight = Math.max(1, Math.floor(sourceHeight * scale));

  canvas.width = targetWidth;
  canvas.height = targetHeight;
  ctx.drawImage(sourceEl, 0, 0, targetWidth, targetHeight);
  let imageData = canvas.toDataURL("image/jpeg", quality);

  let estimatedBytes = Math.floor(imageData.length * 0.75);
  while (targetBytes !== null && estimatedBytes > targetBytes && (quality > 0.4 || targetWidth > minWidth)) {
    if (quality > 0.4) {
      quality -= 0.1;
    } else {
      targetWidth = Math.max(minWidth, Math.floor(targetWidth * 0.9));
      targetHeight = Math.max(minHeight, Math.floor(targetHeight * 0.9));
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      ctx.drawImage(sourceEl, 0, 0, targetWidth, targetHeight);
    }

    imageData = canvas.toDataURL("image/jpeg", quality);
    estimatedBytes = Math.floor(imageData.length * 0.75);
  }

  return { imageData, targetWidth, targetHeight, quality, estimatedBytes };
}

function compressImageFromSource(sourceEl, sourceWidth, sourceHeight) {
  const result = captureImageDataFromSource(sourceEl, sourceWidth, sourceHeight, {
    maxWidth: MAX_CAPTURE_WIDTH,
    initialQuality: 0.7,
    targetBytes: TARGET_IMAGE_BYTES,
    minWidth: 320,
    minHeight: 180
  });

  capturedImageData = result.imageData;
  return result;
}

function updateCameraStatus(message, type) {
  const status = document.getElementById("cameraStatus");
  status.textContent = message;
  status.style.color =
    type === "error" ? "#ef4444" :
    type === "success" ? "#10b981" :
    "#94a3b8";
}

function updateVerificationBadge(text, tone = "info", visible = true) {
  const badge = document.getElementById("verifyBadge");
  if (!badge) {
    return;
  }

  if (!visible) {
    badge.style.display = "none";
    return;
  }

  badge.style.display = "inline-flex";
  badge.textContent = text;
  badge.className = "verify-badge";
  if (tone === "success") {
    badge.classList.add("badge-success");
  } else if (tone === "error") {
    badge.classList.add("badge-error");
  } else {
    badge.classList.add("badge-info");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCameraResolutionSummary(videoEl) {
  if (!stream) {
    return "";
  }

  const track = stream.getVideoTracks()[0];
  if (!track) {
    return "";
  }

  const settings = track.getSettings ? track.getSettings() : {};
  const configuredWidth = settings?.width;
  const configuredHeight = settings?.height;
  const frameWidth = videoEl?.videoWidth;
  const frameHeight = videoEl?.videoHeight;

  const configured = configuredWidth && configuredHeight
    ? `${configuredWidth}x${configuredHeight}`
    : "unknown";
  const frame = frameWidth && frameHeight
    ? `${frameWidth}x${frameHeight}`
    : "unknown";

  return `Camera stream: ${configured} | Video frame: ${frame}`;
}

function classifyVerifyFailure(result) {
  const message = String(result?.message || result?.data?.reason || result?.data?.error || "");
  const normalized = message.toLowerCase();
  if (normalized.includes("ai-generated") || normalized.includes("synthetic")) {
    return "ai";
  }
  if (normalized.includes("handbag") || normalized.includes("gatekeeper") || normalized.includes("no bag")) {
    return "bag";
  }
  return "unknown";
}

async function verifyImageData(imageData) {
  const blob = await (await fetch(imageData)).blob();
  const formData = new FormData();
  formData.append("file", blob, "capture.jpg");

  const response = await fetch("http://127.0.0.1:8000/verify", {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    let detail = `Verifier request failed with status ${response.status}`;
    try {
      const errorPayload = await response.json();
      detail = errorPayload?.detail || errorPayload?.message || detail;
    } catch {
      // Keep default detail.
    }
    throw new Error(detail);
  }

  const result = await response.json();
  const approved = result?.status === "success";
  const failureType = approved ? null : classifyVerifyFailure(result);
  return { approved, failureType, result };
}

async function runLiveAutoVerification() {
  const video = document.getElementById("videoStream");
  if (!video) {
    return;
  }

  while (liveAutoVerifyEnabled && stream) {
    if (liveVerifyBusy) {
      await sleep(250);
      continue;
    }

    if (!video.videoWidth || !video.videoHeight) {
      updateVerificationBadge("Phase: camera warmup", "info", true);
      updateCameraStatus("Warming up camera feed...", "info");
      await sleep(500);
      continue;
    }

    await sleep(2000);
    if (!liveAutoVerifyEnabled || !stream) {
      return;
    }

    liveVerifyBusy = true;
    liveVerifyAttempt += 1;

    try {
      updateVerificationBadge("Phase: bag verifier", "info", true);
      updateCameraStatus(`Checking bag verifier (attempt ${liveVerifyAttempt})...`, "info");
      const verificationFrame = captureImageDataFromSource(video, video.videoWidth, video.videoHeight, {
        maxWidth: VERIFY_CAPTURE_MAX_WIDTH,
        initialQuality: VERIFY_CAPTURE_QUALITY,
        targetBytes: null,
        minWidth: 480,
        minHeight: 270
      });
      const { approved, failureType, result } = await verifyImageData(verificationFrame.imageData);

      if (!liveAutoVerifyEnabled || !stream) {
        return;
      }

      if (approved) {
        updateVerificationBadge("Phase: approved", "success", true);
        imageApproved = true;
        compressImageFromSource(video, video.videoWidth, video.videoHeight);
        document.getElementById("capturedImage").src = capturedImageData;
        document.getElementById("capturedImage").style.display = "block";
        document.getElementById("approveBtn").style.display = "inline-block";
        document.getElementById("approveBtn").textContent = "Approved ✓";
        document.getElementById("clearBtn").style.display = "inline-block";
        const approxKB = Math.round((capturedImageData.length * 0.75) / 1024);
        document.getElementById("imagePreview").textContent = `Auto-approved from live feed (~${approxKB}KB).`;
        updateCameraStatus("Image approved and captured automatically. You can mint now.", "success");
        liveAutoVerifyEnabled = false;
        stopCamera();
        return;
      }

      if (failureType === "bag") {
        updateVerificationBadge("Phase: bag verifier retry", "info", true);
        updateCameraStatus("No handbag detected yet. Retrying in 2 seconds while camera stays live...", "info");
      } else if (failureType === "ai") {
        updateVerificationBadge("Phase: ai checker retry", "error", true);
        const reason = result?.message || result?.data?.reason || "AI checker flagged this frame.";
        updateCameraStatus(`${reason} Retrying in 2 seconds...`, "error");
      } else {
        updateVerificationBadge("Phase: verification retry", "error", true);
        const reason = result?.message || result?.data?.error || "Verification failed.";
        updateCameraStatus(`${reason} Retrying in 2 seconds...`, "error");
      }
    } catch (err) {
      updateVerificationBadge("Phase: verifier unavailable", "error", true);
      updateCameraStatus(`Verifier unavailable: ${err.message || String(err)}. Retrying in 2 seconds...`, "error");
    } finally {
      liveVerifyBusy = false;
    }
  }
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
    updateVerificationBadge("Phase: idle", "info", false);
    updateCameraStatus("Upload an image, then approve it before minting.", "info");
  } else {
    uploadPanel.classList.add("hidden");
    cameraPanel.classList.remove("hidden");
    uploadModeBtn.classList.remove("active");
    cameraModeBtn.classList.add("active");
    updateVerificationBadge("Phase: ready", "info", true);
    updateCameraStatus("Start camera. We will auto-check and auto-capture once approved.", "info");
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
    updateVerificationBadge("Phase: camera starting", "info", true);
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

      const resolutionSummary = getCameraResolutionSummary(video);
      if (resolutionSummary) {
        document.getElementById("imagePreview").textContent = resolutionSummary;
        console.log(`[camera] ${resolutionSummary}`);
      }
    };

    document.getElementById("startCameraBtn").style.display = "none";
    document.getElementById("backBtn").style.display = "inline-flex";
    document.getElementById("captureBtn").style.display = "none";
    document.getElementById("stopCameraBtn").style.display = "inline-block";
    document.getElementById("approveBtn").style.display = "none";

    liveAutoVerifyEnabled = true;
    liveVerifyAttempt = 0;
    runLiveAutoVerification();

    updateVerificationBadge("Phase: live checks running", "info", true);
    updateCameraStatus("Camera is live. Auto-checking bag verifier and AI checker every 2 seconds...", "success");

    const immediateResolutionSummary = getCameraResolutionSummary(video);
    if (immediateResolutionSummary) {
      document.getElementById("imagePreview").textContent = immediateResolutionSummary;
      console.log(`[camera] ${immediateResolutionSummary}`);
    }
  } catch (err) {
    updateVerificationBadge("Phase: camera error", "error", true);
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

  liveAutoVerifyEnabled = false;
  stopCamera();
  document.getElementById("startCameraBtn").style.display = "none";

  updateCameraStatus("Image captured from live feed. Approve image before minting.", "success");
  const approxKB = Math.round(estimatedBytes / 1024);
  document.getElementById("imagePreview").textContent =
    `Image prepared (${targetWidth}x${targetHeight}, q=${quality.toFixed(2)}, ~${approxKB}KB).`;
}

function stopCamera() {
  liveAutoVerifyEnabled = false;
  updateVerificationBadge("Phase: stopped", "info", true);

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
    const { approved, result } = await verifyImageData(capturedImageData);
    if (approved) {
      updateVerificationBadge("Phase: approved", "success", true);
      imageApproved = true;
      document.getElementById("approveBtn").textContent = "Approved ✓";
      updateCameraStatus("Image approved. You can mint now.", "success");
      document.getElementById("imagePreview").textContent =
        "Verification passed. Image approved for minting.";
      return;
    }

    updateCameraStatus(
      result?.message || "Verification failed. Please retake or upload a clearer image.",
      "error"
    );
    updateVerificationBadge("Phase: failed", "error", true);
    return;
  } catch {
    // fallback
  }

  updateVerificationBadge("Phase: approved (fallback)", "success", true);
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
  const transferSessionToken = verifiedTransferSessionToken;

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

  if (!paymentVerified || !transferSessionToken) {
    showStatus("Please verify the identity transfer before minting.", true);
    return;
  }

  mintBtn.disabled = true;
  showStatus("Uploading image...");

  try {
    const uploadRes = await fetch(apiUrl("/upload-image"), {
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

    const res = await fetch(apiUrl("/mint"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bagName,
        itemDescription,
        condition,
        material,
        imageURI: uploadData.imageURI,
        transferSessionToken,
        listing,
        recipientId: sellerWalletId,
        senderWalletId: sellerWalletId
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

    const transferMessage = data?.identityTransfer?.attempted
      ? data.identityTransfer.success
        ? " | identity transfer completed"
        : ` | identity transfer failed: ${data.identityTransfer.error || "unknown error"}`
      : "";

    showStatus(`Success! Minted. Tx hash: ${data.txHash}${mintedTokenPart}${sponsoredStoragePart}${transferMessage}`,
      Boolean(data?.identityTransfer?.attempted && !data.identityTransfer.success)
    );

    document.getElementById("bagName").value = "";
    document.getElementById("itemDescription").value = "";
    document.getElementById("condition").value = "";
    document.getElementById("material").value = "";
    document.getElementById("listingMode").value = "fixed";
    document.getElementById("fixedPriceDash").value = "";
    document.getElementById("startBidDash").value = "";
    document.getElementById("listingEndTime").value = "";
    document.getElementById("sellerWalletId").value = "";
    document.getElementById("minterIdentityId").value = "";
    document.getElementById("authAddress").value = "";
    document.getElementById("authSignature").value = "";
    document.getElementById("authChallengeMessage").value = "";
    document.getElementById("transferCredits").value = "";
    document.getElementById("transferIdentityIndex").value = "0";
    capturedImageData = null;
    imageApproved = false;
    invalidateTransferVerification();
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
    const res = await fetch(apiUrl(`/read?tokenId=${encodeURIComponent(tokenId)}`));
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
  copyChallengeBtn?.addEventListener("click", copyAuthChallengeMessage);

  ["minterIdentityId", "authAddress", "authSignature", "transferCredits", "transferIdentityIndex"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", () => {
      if (paymentVerified) {
        invalidateTransferVerification();
        showDashPaymentStatus("Identity details changed. Verify transfer again before minting.", true);
      }
    });
  });

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