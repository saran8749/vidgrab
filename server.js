const express = require("express");
const { execFile } = require("child_process");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 5000;

// ── Detect yt-dlp binary location ─────────────────────────────────────────────
// Check if yt-dlp exists locally in the project directory (Render fallback)
const localYtdlp = path.join(__dirname, "yt-dlp");
const YTDLP_CMD = fs.existsSync(localYtdlp) ? localYtdlp : "yt-dlp";


// ── Security Middleware ────────────────────────────────────────────────────────

// Helmet — sets secure HTTP headers (XSS protection, no-sniff, HSTS, etc.)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://unpkg.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "https:", "data:"],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'", "https:"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'", "https://www.profitablecpmratenetwork.com"],
      },
    },
    crossOriginEmbedderPolicy: false, // Allow loading external fonts/icons
  })
);

// CORS — restrict to same origin in production
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || true, // Set to your domain in production
    methods: ["GET"],
    optionsSuccessStatus: 200,
  })
);

// Rate limiting — prevent abuse & brute-force
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 15, // max 15 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a minute and try again." },
});

const downloadLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10, // max 10 downloads per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many download requests. Please slow down." },
});

// Body parser with size limit
app.use(express.json({ limit: "1kb" }));

// Serve static files with caching headers
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: "1h",
    etag: true,
  })
);

// ── URL Validation Helper ──────────────────────────────────────────────────────
function isValidUrl(urlString) {
  try {
    const url = new URL(urlString);
    // Only allow http and https protocols
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    // Block local/private network access (SSRF protection)
    const hostname = url.hostname.toLowerCase();
    const blockedPatterns = [
      "localhost",
      "127.0.0.1",
      "0.0.0.0",
      "::1",
      "169.254.",  // Link-local
      "10.",       // Private Class A
      "192.168.",  // Private Class C
    ];
    for (const pattern of blockedPatterns) {
      if (hostname.startsWith(pattern) || hostname === pattern) {
        return false;
      }
    }
    // Block 172.16.0.0 - 172.31.255.255 (Private Class B)
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ── API: Fetch video info ──────────────────────────────────────────────────────
app.get("/api/video", apiLimiter, (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ error: "No URL provided" });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({ error: "Invalid or disallowed URL" });
  }

  // Use execFile instead of exec — prevents shell injection entirely
  // execFile does NOT use a shell, so special characters are harmless
  console.log(`[API] Fetching video info for: ${url}`);
  execFile(
    YTDLP_CMD,
    ["-J", "--no-warnings", "--no-exec", "--no-batch-file", url],
    { maxBuffer: 1024 * 1024 * 10, timeout: 120000 },
    (error, stdout, stderr) => {
      if (error) {
        console.error("yt-dlp error code:", error.code);
        console.error("yt-dlp stderr:", stderr);
        console.error("yt-dlp error message:", error.message);
        return res.status(500).json({
          error:
            "Failed to fetch video info. Make sure the URL is valid and supported.",
        });
      }

      try {
        const data = JSON.parse(stdout);

        // Extract video formats (with video + audio)
        const videoFormats = [];
        const seenQualities = new Set();

        if (data.formats) {
          // Sort by quality (height) descending
          const sorted = data.formats
            .filter((f) => f.height && f.url && f.ext)
            .sort((a, b) => (b.height || 0) - (a.height || 0));

          for (const f of sorted) {
            const quality = `${f.height}p`;
            if (!seenQualities.has(quality)) {
              seenQualities.add(quality);
              videoFormats.push({
                quality,
                height: f.height,
                ext: f.ext,
                url: f.url,
                filesize: f.filesize || f.filesize_approx || null,
                vcodec: f.vcodec || "unknown",
                acodec: f.acodec || "none",
                fps: f.fps || null,
                format_note: f.format_note || "",
              });
            }
          }
        }

        // Extract audio-only formats
        const audioFormats = [];
        const seenAudioBitrates = new Set();

        if (data.formats) {
          const audioSorted = data.formats
            .filter(
              (f) =>
                f.url &&
                f.acodec &&
                f.acodec !== "none" &&
                (!f.vcodec || f.vcodec === "none")
            )
            .sort((a, b) => (b.abr || 0) - (a.abr || 0));

          for (const f of audioSorted) {
            const bitrate = f.abr ? `${Math.round(f.abr)}kbps` : "unknown";
            if (!seenAudioBitrates.has(bitrate) && bitrate !== "unknown") {
              seenAudioBitrates.add(bitrate);
              audioFormats.push({
                bitrate,
                ext: f.ext,
                url: f.url,
                filesize: f.filesize || f.filesize_approx || null,
                acodec: f.acodec,
              });
            }
          }
        }

        const response = {
          title: data.title || "Untitled",
          thumbnail: data.thumbnail || null,
          duration: data.duration || 0,
          duration_string: data.duration_string || "0:00",
          uploader: data.uploader || data.channel || "Unknown",
          view_count: data.view_count || 0,
          like_count: data.like_count || 0,
          description: data.description
            ? data.description.substring(0, 300)
            : "",
          webpage_url: data.webpage_url || url,
          videoFormats,
          audioFormats,
        };

        res.json(response);
      } catch (parseError) {
        console.error("Parse error:", parseError.message);
        res.status(500).json({ error: "Failed to parse video data" });
      }
    }
  );
});

// ── API: Download file via proxy (with security checks) ─────────────────────
app.get("/api/download", downloadLimiter, (req, res) => {
  const fileUrl = req.query.url;
  const filename = req.query.filename || "video";
  const ext = req.query.ext || "mp4";

  if (!fileUrl) {
    return res.status(400).json({ error: "No file URL provided" });
  }

  if (!isValidUrl(fileUrl)) {
    return res.status(400).json({ error: "Invalid download URL" });
  }

  // Whitelist allowed extensions
  const allowedExts = ["mp4", "webm", "mkv", "mp3", "m4a", "ogg", "opus", "wav", "flac", "aac"];
  const safeExt = allowedExts.includes(ext.toLowerCase()) ? ext.toLowerCase() : "mp4";

  // Sanitize filename — allow only safe characters
  const sanitizedFilename = filename
    .replace(/[^a-zA-Z0-9_\-\s]/g, "")
    .substring(0, 100)
    .trim() || "download";

  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${sanitizedFilename}.${safeExt}"`
  );
  res.setHeader("Content-Type", "application/octet-stream");

  // Prevent caching of downloads
  res.setHeader("Cache-Control", "no-store");

  const protocol = fileUrl.startsWith("https") ? https : http;

  const request = protocol
    .get(fileUrl, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 30000 }, (fileRes) => {
      if (
        fileRes.statusCode >= 300 &&
        fileRes.statusCode < 400 &&
        fileRes.headers.location
      ) {
        const redirectUrl = fileRes.headers.location;
        // Validate redirect URL too
        if (!isValidUrl(redirectUrl)) {
          return res.status(400).json({ error: "Unsafe redirect detected" });
        }
        const redirectProtocol = redirectUrl.startsWith("https") ? https : http;
        redirectProtocol
          .get(
            redirectUrl,
            { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 30000 },
            (redirectRes) => {
              if (redirectRes.headers["content-length"]) {
                res.setHeader(
                  "Content-Length",
                  redirectRes.headers["content-length"]
                );
              }
              redirectRes.pipe(res);
            }
          )
          .on("error", (err) => {
            console.error("Redirect download error:", err.message);
            if (!res.headersSent) {
              res.status(500).json({ error: "Download failed" });
            }
          });
      } else if (fileRes.statusCode === 200) {
        if (fileRes.headers["content-length"]) {
          res.setHeader("Content-Length", fileRes.headers["content-length"]);
        }
        fileRes.pipe(res);
      } else {
        res.status(fileRes.statusCode).json({ error: "Download source returned an error" });
      }
    })
    .on("error", (err) => {
      console.error("Download error:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Download failed" });
      }
    })
    .on("timeout", () => {
      request.destroy();
      if (!res.headersSent) {
        res.status(504).json({ error: "Download timed out" });
      }
    });
});

// ── API: Extract audio using yt-dlp ─────────────────────────────────────────
app.get("/api/extract-audio", downloadLimiter, (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ error: "No URL provided" });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({ error: "Invalid or disallowed URL" });
  }

  // Use a unique, safe filename for temp storage
  const safeId = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  const outputPath = path.join(__dirname, "temp", `audio_${safeId}.mp3`);

  // Ensure temp directory exists
  const tempDir = path.join(__dirname, "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Use execFile — no shell injection possible
  execFile(
    YTDLP_CMD,
    ["-x", "--audio-format", "mp3", "--audio-quality", "0", "--no-exec", "--no-batch-file", "-o", outputPath, url],
    { maxBuffer: 1024 * 1024 * 10, timeout: 300000 },
    (error, stdout, stderr) => {
      if (error) {
        console.error("Audio extraction error:", stderr || error.message);
        // Cleanup on error
        try { fs.unlinkSync(outputPath); } catch {}
        return res.status(500).json({ error: "Failed to extract audio" });
      }

      if (fs.existsSync(outputPath)) {
        res.download(outputPath, "audio.mp3", (err) => {
          // Always clean up temp file
          try {
            fs.unlinkSync(outputPath);
          } catch (e) {}
        });
      } else {
        res.status(500).json({ error: "Audio file not found after extraction" });
      }
    }
  );
});

// ── Cleanup: Periodically remove stale temp files ────────────────────────────
setInterval(() => {
  const tempDir = path.join(__dirname, "temp");
  if (!fs.existsSync(tempDir)) return;
  const files = fs.readdirSync(tempDir);
  const now = Date.now();
  for (const file of files) {
    const filePath = path.join(tempDir, file);
    try {
      const stat = fs.statSync(filePath);
      // Remove files older than 10 minutes
      if (now - stat.mtimeMs > 10 * 60 * 1000) {
        fs.unlinkSync(filePath);
      }
    } catch {}
  }
}, 5 * 60 * 1000); // Run every 5 minutes

// ── Health check endpoint ────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  execFile(YTDLP_CMD, ["--version"], { timeout: 10000 }, (error, stdout) => {
    res.json({
      status: "ok",
      ytdlp: error ? "not available" : stdout.trim(),
      node: process.version,
      uptime: process.uptime(),
    });
  });
});

// ── Serve frontend ──────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Catch-all: return 404 for unknown routes ────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ── Global error handler ────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 VidGrab Server running at http://localhost:${PORT}`);
  console.log(`🔒 Security: Helmet, Rate-Limiting, SSRF Protection enabled`);

  // Check if yt-dlp is available
  execFile(YTDLP_CMD, ["--version"], { timeout: 10000 }, (error, stdout) => {
    if (error) {
      console.error("⚠️  yt-dlp is NOT available! Video fetching will fail.");
      console.error("   Error:", error.message);
    } else {
      console.log(`✅ yt-dlp version: ${stdout.trim()}`);
    }
  });
});
