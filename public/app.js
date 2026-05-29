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

  // Fetch Video button
  const btnFetch = document.getElementById("btn-fetch");
  if (btnFetch) {
    btnFetch.addEventListener("click", () => fetchVideo());
  }

  // Retry button
  const btnRetry = document.getElementById("btn-retry");
  if (btnRetry) {
    btnRetry.addEventListener("click", () => retryFetch());
  }

  // Extract Audio button
  const btnExtractAudio = document.getElementById("btn-extract-audio");
  if (btnExtractAudio) {
    btnExtractAudio.addEventListener("click", () => extractAudio());
  }

  // Play overlay (video preview toggle)
  const playOverlay = document.getElementById("play-overlay");
  if (playOverlay) {
    playOverlay.addEventListener("click", () => togglePreview());
  }

  // Close preview button
  const btnClosePreview = document.getElementById("btn-close-preview");
  if (btnClosePreview) {
    btnClosePreview.addEventListener("click", () => togglePreview());
  }

  // FAQ accordion items
  document.querySelectorAll(".faq-item").forEach((item) => {
    item.querySelector(".faq-question")?.addEventListener("click", () => toggleFaq(item));
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
      const fullError = (data.details || data.stderr) ? `${data.error} | ${data.details || data.stderr}` : data.error;
      showError(fullError);
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
      card.onclick = () => downloadFormat({ format_id: f.format_id, url: f.url, quality: f.bitrate, ext: f.ext, filesize: f.filesize }, data.title);
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
  const originalUrl = document.getElementById("url-input")?.value.trim() || "";
  
  let downloadUrl = `/api/download?url=${encodeURIComponent(format.url)}&filename=${encodeURIComponent(safeTitle + "_" + format.quality)}&ext=${format.ext || "mp4"}`;
  
  if (originalUrl) {
    downloadUrl += `&video_url=${encodeURIComponent(originalUrl)}`;
  }
  if (format.format_id) {
    downloadUrl += `&format_id=${encodeURIComponent(format.format_id)}`;
  }
  if (format.acodec) {
    downloadUrl += `&acodec=${encodeURIComponent(format.acodec)}`;
  }
  if (format.filesize) {
    downloadUrl += `&filesize=${encodeURIComponent(format.filesize)}`;
  }

  const a = document.createElement("a");
  a.href = downloadUrl;
  a.download = `${safeTitle}_${format.quality}.${format.ext || "mp4"}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Show customized merging message if video-only format is being downloaded
  if (format.acodec === "none") {
    showToast("Merging high-quality streams on server... This may take up to 10 seconds.", "info");
  } else {
    showToast(`Downloading ${format.quality}...`);
  }
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
  const errMsgEl = document.getElementById("error-message");
  
  if (message.toLowerCase().includes("bot") || message.toLowerCase().includes("cookies")) {
    errMsgEl.innerHTML = `
      <div style="text-align: left; margin-top: 15px; font-size: 0.9rem; line-height: 1.5; color: var(--text-muted); background: rgba(239, 68, 68, 0.05); padding: 16px; border-radius: 12px; border: 1px dashed rgba(239, 68, 68, 0.2);">
        <p style="font-weight: 600; margin-bottom: 8px; color: var(--primary); font-size: 1rem; display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 1.2rem;">⚠️</span> YouTube Bot Protection Active
        </p>
        <p style="margin-bottom: 10px;">YouTube has flagged the server's datacenter IP address. To fix this and unlock 100% of downloads, please follow these steps:</p>
        <ol style="margin-left: 20px; margin-bottom: 10px; list-style-type: decimal; display: flex; flex-direction: column; gap: 6px;">
          <li>Install the browser extension <strong>"Get cookies.txt LOCALLY"</strong> (Chrome/Firefox).</li>
          <li>Log into a <strong>dummy/burner</strong> Google account on YouTube.</li>
          <li>Open the extension on YouTube, export cookies in <strong>Netscape</strong> format, save them as <code>cookies.txt</code>, and push it to the root of your GitHub repository.</li>
        </ol>
        <p style="font-size: 0.8rem; color: var(--text-muted); border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 8px; margin-top: 8px;">
          Render will automatically rebuild and your site will be fully operational!
        </p>
      </div>
    `;
  } else {
    errMsgEl.textContent = message;
  }
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


