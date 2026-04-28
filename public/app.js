// ── State ────────────────────────────────────────────────────────────────────
let currentVideoData = null;
let currentTab = "download";

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  lucide.createIcons();
  setupEventListeners();
  initParticles();
  initScrollReveal();
  initRippleEffect();
  initTypingPlaceholder();
  initAds();
});

function setupEventListeners() {
  // Tab navigation
  document.querySelectorAll(".pill").forEach((pill) => {
    pill.addEventListener("click", () => switchTab(pill.dataset.tab));
  });

  // URL input
  const urlInput = document.getElementById("url-input");
  const btnClear = document.getElementById("btn-clear");

  urlInput.addEventListener("input", () => {
    btnClear.classList.toggle("visible", urlInput.value.length > 0);
  });

  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") fetchVideo();
  });

  btnClear.addEventListener("click", () => {
    urlInput.value = "";
    btnClear.classList.remove("visible");
    urlInput.focus();
  });
}

// ── Tab Switching ────────────────────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".pill").forEach((p) => p.classList.remove("active"));
  document.querySelector(`[data-tab="${tab}"]`).classList.add("active");

  const heroSection = document.getElementById("hero-section");
  const resultsSection = document.getElementById("results-section");
  const aboutSection = document.getElementById("about-section");
  const howtoSection = document.getElementById("howto-section");
  const loadingSection = document.getElementById("loading-section");
  const errorSection = document.getElementById("error-section");

  // Hide all tab-specific content
  aboutSection.classList.add("hidden");
  howtoSection.classList.add("hidden");

  if (tab === "about") {
    heroSection.classList.add("hidden");
    resultsSection.classList.add("hidden");
    loadingSection.classList.add("hidden");
    errorSection.classList.add("hidden");
    aboutSection.classList.remove("hidden");
  } else if (tab === "howto") {
    heroSection.classList.add("hidden");
    resultsSection.classList.add("hidden");
    loadingSection.classList.add("hidden");
    errorSection.classList.add("hidden");
    howtoSection.classList.remove("hidden");
  } else if (tab === "download" || tab === "audio") {
    heroSection.classList.remove("hidden");
    if (currentVideoData) {
      resultsSection.classList.remove("hidden");
    }
  }

  lucide.createIcons();
}

// ── FAQ Accordion ────────────────────────────────────────────────────────────
function toggleFaq(item) {
  const wasOpen = item.classList.contains("open");
  // Close all FAQ items
  document.querySelectorAll(".faq-item").forEach((faq) => faq.classList.remove("open"));
  // Toggle the clicked one
  if (!wasOpen) {
    item.classList.add("open");
  }
}

// ── Fetch Video ──────────────────────────────────────────────────────────────
async function fetchVideo() {
  const url = document.getElementById("url-input").value.trim();
  if (!url) {
    showToast("Please paste a video URL", "error");
    return;
  }

  // Basic URL validation
  try {
    new URL(url);
  } catch {
    showToast("Please enter a valid URL", "error");
    return;
  }

  showSection("loading");
  document.getElementById("btn-fetch").disabled = true;

  try {
    const res = await fetch(`/api/video?url=${encodeURIComponent(url)}`);
    const data = await res.json();

    if (data.error) {
      showError(data.error);
      return;
    }

    currentVideoData = data;
    renderResults(data);
    showSection("results");
    showToast("Video info fetched successfully!");
  } catch (err) {
    showError("Network error. Make sure the server is running.");
  } finally {
    document.getElementById("btn-fetch").disabled = false;
  }
}

function retryFetch() {
  fetchVideo();
}

// ── Render Results ───────────────────────────────────────────────────────────
function renderResults(data) {
  // Thumbnail
  const thumb = document.getElementById("video-thumbnail");
  if (data.thumbnail) {
    thumb.src = data.thumbnail;
    thumb.alt = data.title;
  } else {
    thumb.src = "";
    thumb.alt = "No thumbnail";
  }

  // Info
  document.getElementById("video-title").textContent = data.title;
  document.getElementById("video-duration").textContent = data.duration_string || "0:00";
  document.getElementById("video-uploader").innerHTML = `<i data-lucide="user" class="meta-icon"></i> ${escapeHtml(data.uploader)}`;
  document.getElementById("video-views").innerHTML = `<i data-lucide="eye" class="meta-icon"></i> ${formatNumber(data.view_count)} views`;
  document.getElementById("video-likes").innerHTML = `<i data-lucide="thumbs-up" class="meta-icon"></i> ${formatNumber(data.like_count)} likes`;
  document.getElementById("video-description").textContent = data.description || "";

  // Video Formats
  const videoGrid = document.getElementById("video-formats");
  videoGrid.innerHTML = "";

  if (data.videoFormats && data.videoFormats.length > 0) {
    data.videoFormats.forEach((f) => {
      const qualityClass = getQualityClass(f.height);
      const sizeStr = f.filesize ? formatFileSize(f.filesize) : "—";
      const card = document.createElement("div");
      card.className = "format-card";
      card.onclick = () => downloadFormat(f, data.title);
      card.innerHTML = `
        <div class="format-info">
          <span class="format-quality ${qualityClass}">${f.quality}</span>
          <span class="format-details">${f.ext.toUpperCase()} · ${f.fps ? f.fps + "fps" : ""}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="format-size">${sizeStr}</span>
          <button class="format-dl-btn" title="Download ${f.quality}">
            <i data-lucide="download"></i>
          </button>
        </div>
      `;
      videoGrid.appendChild(card);
    });
  } else {
    videoGrid.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;grid-column:1/-1;">No video formats found</p>`;
  }

  // Audio Formats
  const audioGrid = document.getElementById("audio-formats");
  audioGrid.innerHTML = "";

  if (data.audioFormats && data.audioFormats.length > 0) {
    data.audioFormats.forEach((f) => {
      const sizeStr = f.filesize ? formatFileSize(f.filesize) : "—";
      const card = document.createElement("div");
      card.className = "format-card";
      card.onclick = () => downloadFormat({ url: f.url, quality: f.bitrate, ext: f.ext }, data.title);
      card.innerHTML = `
        <div class="format-info">
          <span class="format-quality" style="color:var(--accent-light);">${f.bitrate}</span>
          <span class="format-details">${f.ext.toUpperCase()} · ${f.acodec}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="format-size">${sizeStr}</span>
          <button class="format-dl-btn" title="Download ${f.bitrate}">
            <i data-lucide="download"></i>
          </button>
        </div>
      `;
      audioGrid.appendChild(card);
    });
    document.getElementById("audio-section-wrap").classList.remove("hidden");
  } else {
    document.getElementById("audio-section-wrap").classList.add("hidden");
  }

  lucide.createIcons();
}

// ── Download ─────────────────────────────────────────────────────────────────
function downloadFormat(format, title) {
  const safeTitle = (title || "video").replace(/[^a-zA-Z0-9\s\-_]/g, "").substring(0, 80);
  const downloadUrl = `/api/download?url=${encodeURIComponent(format.url)}&filename=${encodeURIComponent(safeTitle + "_" + format.quality)}&ext=${format.ext || "mp4"}`;

  const a = document.createElement("a");
  a.href = downloadUrl;
  a.download = `${safeTitle}_${format.quality}.${format.ext || "mp4"}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  showToast(`Downloading ${format.quality}...`);
}

// ── Extract Audio ────────────────────────────────────────────────────────────
async function extractAudio() {
  const url = document.getElementById("url-input").value.trim();
  if (!url) {
    showToast("No URL to extract audio from", "error");
    return;
  }

  const btn = document.getElementById("btn-extract-audio");
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader" class="btn-icon" style="animation:spin 1s linear infinite;"></i> Extracting...`;
  lucide.createIcons();

  showToast("Extracting MP3... This may take a moment.");

  try {
    const downloadUrl = `/api/extract-audio?url=${encodeURIComponent(url)}`;
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = "audio.mp3";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (err) {
    showToast("Audio extraction failed", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="music" class="btn-icon"></i> Extract Best Quality MP3`;
    lucide.createIcons();
  }
}

// ── Video Preview ────────────────────────────────────────────────────────────
function togglePreview() {
  const previewDiv = document.getElementById("preview-player");
  const video = document.getElementById("preview-video");

  if (previewDiv.classList.contains("hidden")) {
    // Try to find a playable format
    if (currentVideoData && currentVideoData.videoFormats.length > 0) {
      // Prefer a lower quality format for preview
      const previewFormat =
        currentVideoData.videoFormats.find((f) => f.height <= 480) ||
        currentVideoData.videoFormats[currentVideoData.videoFormats.length - 1];
      video.src = previewFormat.url;
      video.play().catch(() => {});
    }
    previewDiv.classList.remove("hidden");
  } else {
    video.pause();
    video.src = "";
    previewDiv.classList.add("hidden");
  }
}

// ── UI Helpers ───────────────────────────────────────────────────────────────
function showSection(section) {
  const sections = ["hero", "loading", "error", "results"];
  const sectionMap = {
    hero: "hero-section",
    loading: "loading-section",
    error: "error-section",
    results: "results-section",
  };

  // Always show hero
  document.getElementById("hero-section").classList.remove("hidden");

  // Toggle other sections
  ["loading-section", "error-section", "results-section"].forEach((id) => {
    document.getElementById(id).classList.add("hidden");
  });

  if (section !== "hero" && sectionMap[section]) {
    document.getElementById(sectionMap[section]).classList.remove("hidden");
  }
}

function showError(message) {
  document.getElementById("error-message").textContent = message;
  showSection("error");
}

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  const toastMsg = document.getElementById("toast-message");
  const toastIcon = document.getElementById("toast-icon");

  toastMsg.textContent = message;
  toast.className = `toast visible ${type}`;

  // Update icon
  if (type === "error") {
    toastIcon.setAttribute("data-lucide", "alert-circle");
  } else {
    toastIcon.setAttribute("data-lucide", "check-circle");
  }
  lucide.createIcons();

  setTimeout(() => {
    toast.classList.remove("visible");
  }, 3500);
}

function getQualityClass(height) {
  if (height >= 2160) return "q-2160";
  if (height >= 1080) return "q-1080";
  if (height >= 720) return "q-720";
  if (height >= 480) return "q-480";
  return "q-360";
}

function formatFileSize(bytes) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

function formatNumber(num) {
  if (!num) return "0";
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── Floating Particles ───────────────────────────────────────────────────────
function initParticles() {
  const canvas = document.createElement("canvas");
  canvas.id = "particle-canvas";
  document.body.prepend(canvas);
  const ctx = canvas.getContext("2d");
  let w, h, particles;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  const PARTICLE_COUNT = 45;
  particles = Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: Math.random() * 2 + 0.5,
    dx: (Math.random() - 0.5) * 0.4,
    dy: (Math.random() - 0.5) * 0.4,
    o: Math.random() * 0.4 + 0.1,
  }));

  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      p.x += p.dx;
      p.y += p.dy;
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(157,132,253,${p.o})`;
      ctx.fill();
    }
    // Draw faint connecting lines for nearby particles
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(124,92,252,${0.06 * (1 - dist / 120)})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(draw);
  }
  draw();
}

// ── Scroll Reveal ────────────────────────────────────────────────────────────
function initScrollReveal() {
  // Add reveal class to key sections
  const selectors = [".downloads-section", ".about-card", ".features-grid", ".disclaimer"];
  selectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => el.classList.add("reveal"));
  });
  document.querySelectorAll(".features-grid").forEach((g) => g.classList.add("stagger"));

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("visible");
          // Also reveal staggered children
          if (e.target.classList.contains("stagger")) {
            e.target.querySelectorAll(".feature-card").forEach((c) => c.classList.add("visible"));
          }
        }
      });
    },
    { threshold: 0.15 }
  );

  document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
}

// ── Ripple Effect ────────────────────────────────────────────────────────────
function initRippleEffect() {
  const buttons = document.querySelectorAll(".btn-fetch, .btn-extract-audio, .pill, .btn-retry");
  buttons.forEach((btn) => {
    btn.style.position = "relative";
    btn.style.overflow = "hidden";
    btn.addEventListener("click", function (e) {
      const ripple = document.createElement("span");
      ripple.className = "ripple";
      const rect = this.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      ripple.style.width = ripple.style.height = size + "px";
      ripple.style.left = e.clientX - rect.left - size / 2 + "px";
      ripple.style.top = e.clientY - rect.top - size / 2 + "px";
      this.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove());
    });
  });
}

// ── Typing Placeholder ──────────────────────────────────────────────────────
function initTypingPlaceholder() {
  const input = document.getElementById("url-input");
  if (!input) return;
  const phrases = [
    "Paste a YouTube URL...",
    "Try a Vimeo link...",
    "Got an Instagram reel?",
    "Any video URL works!",
    "Drop a Twitter/X video link...",
  ];
  let pi = 0, ci = 0, deleting = false;
  input.placeholder = "";

  function type() {
    if (document.activeElement === input || input.value.length > 0) {
      setTimeout(type, 500);
      return;
    }
    const phrase = phrases[pi];
    if (!deleting) {
      input.placeholder = phrase.substring(0, ci + 1);
      ci++;
      if (ci >= phrase.length) {
        deleting = true;
        setTimeout(type, 2000);
        return;
      }
      setTimeout(type, 70 + Math.random() * 40);
    } else {
      input.placeholder = phrase.substring(0, ci);
      ci--;
      if (ci < 0) {
        deleting = false;
        ci = 0;
        pi = (pi + 1) % phrases.length;
        setTimeout(type, 400);
        return;
      }
      setTimeout(type, 35);
    }
  }
  setTimeout(type, 800);
}

// ── Ad Management ────────────────────────────────────────────────────────────
function initAds() {
  // ── Close Top Banner Ad ──
  const adCloseTop = document.getElementById("ad-close-top");
  const adBannerTop = document.getElementById("ad-banner-top");
  if (adCloseTop && adBannerTop) {
    adCloseTop.addEventListener("click", () => {
      adBannerTop.style.transition = "opacity 0.4s ease, max-height 0.4s ease, margin 0.3s ease";
      adBannerTop.style.opacity = "0";
      adBannerTop.style.maxHeight = "0";
      adBannerTop.style.marginBottom = "0";
      adBannerTop.style.overflow = "hidden";
      setTimeout(() => adBannerTop.remove(), 500);
    });
  }

  // ── Close Sticky Bottom Ad ──
  const adStickyClose = document.getElementById("ad-sticky-close");
  const adStickyBottom = document.getElementById("ad-sticky-bottom");
  if (adStickyClose && adStickyBottom) {
    adStickyClose.addEventListener("click", () => {
      adStickyBottom.style.transition = "transform 0.5s cubic-bezier(.4,0,.2,1)";
      adStickyBottom.style.transform = "translateY(100%)";
      setTimeout(() => adStickyBottom.remove(), 600);
    });
  }

  // ── Popup Ad (Interstitial) — show after delay on first visit ──
  const popupOverlay = document.getElementById("ad-popup-overlay");
  const popupClose = document.getElementById("ad-popup-close");

  if (popupOverlay && !sessionStorage.getItem("vg_popup_shown")) {
    setTimeout(() => {
      popupOverlay.classList.remove("hidden");
      lucide.createIcons();
      sessionStorage.setItem("vg_popup_shown", "1");
    }, 8000); // Show after 8 seconds
  }

  if (popupClose && popupOverlay) {
    popupClose.addEventListener("click", () => {
      popupOverlay.style.animation = "none";
      popupOverlay.style.transition = "opacity 0.3s ease";
      popupOverlay.style.opacity = "0";
      setTimeout(() => {
        popupOverlay.classList.add("hidden");
        popupOverlay.style.opacity = "";
      }, 350);
    });

    // Close on overlay click (outside the popup card)
    popupOverlay.addEventListener("click", (e) => {
      if (e.target === popupOverlay) {
        popupClose.click();
      }
    });
  }

  // Re-initialize Lucide icons for ad elements
  lucide.createIcons();
}
