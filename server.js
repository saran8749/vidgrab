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
const localYtdlp = path.join(__dirname, "yt-dlp");
const YTDLP_CMD = fs.existsSync(localYtdlp) ? localYtdlp : "yt-dlp";

// ── Cobalt API Configuration ──────────────────────────────────────────────────
const COBALT_API_URL = "https://api.cobalt.tools/";
const COBALT_TIMEOUT = 30000;

// ── Invidious API Configuration ───────────────────────────────────────────────
const INVIDIOUS_INSTANCES = [
  "https://vid.puffyan.us",
  "https://invidious.fdn.fr",
  "https://y.com.sb",
  "https://invidious.lunar.icu",
  "https://inv.tux.pizza",
];

// ── Security Middleware ────────────────────────────────────────────────────────
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
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || true,
    methods: ["GET"],
    optionsSuccessStatus: 200,
  })
);

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a minute and try again." },
});

const downloadLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many download requests. Please slow down." },
});

app.use(express.json({ limit: "1kb" }));

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
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    const hostname = url.hostname.toLowerCase();
    const blockedPatterns = [
      "localhost", "127.0.0.1", "0.0.0.0", "::1",
      "169.254.", "10.", "192.168.",
    ];
    for (const pattern of blockedPatterns) {
      if (hostname.startsWith(pattern) || hostname === pattern) {
        return false;
      }
    }
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ── Extract YouTube video ID from URL ─────────────────────────────────────────
function extractYouTubeId(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace("www.", "");

    if (hostname === "youtu.be") {
      return parsed.pathname.slice(1).split("/")[0];
    }
    if (hostname === "youtube.com" || hostname === "m.youtube.com") {
      // /watch?v=ID
      if (parsed.searchParams.has("v")) {
        return parsed.searchParams.get("v");
      }
      // /shorts/ID or /embed/ID or /v/ID
      const match = parsed.pathname.match(/\/(shorts|embed|v)\/([^/?]+)/);
      if (match) return match[2];
    }
    return null;
  } catch {
    return null;
  }
}

// ── STRATEGY 1: yt-dlp (Primary) ─────────────────────────────────────────────
function fetchWithYtdlp(url) {
  return new Promise((resolve, reject) => {
    console.log("[Strategy 1: yt-dlp] Attempting fetch...");
    const spawnArgs = [
      "-J", "--no-warnings", "--no-exec", "--no-batch-file",
      "--extractor-args", "youtube:player-client=mediaconnect,web",
      url
    ];

    execFile(
      YTDLP_CMD,
      spawnArgs,
      { maxBuffer: 1024 * 1024 * 10, timeout: 60000 },
      (error, stdout, stderr) => {
        if (error) {
          console.error("[Strategy 1: yt-dlp] FAILED:", stderr || error.message);
          return reject(new Error(stderr || error.message));
        }
        try {
          const data = JSON.parse(stdout);
          console.log("[Strategy 1: yt-dlp] SUCCESS — title:", data.title);
          resolve({ data, strategy: "yt-dlp" });
        } catch (parseError) {
          reject(new Error("Failed to parse yt-dlp output"));
        }
      }
    );
  });
}

// ── STRATEGY 2: Cobalt API (Fallback) ─────────────────────────────────────────
function fetchWithCobalt(url) {
  return new Promise((resolve, reject) => {
    console.log("[Strategy 2: Cobalt] Attempting fetch...");

    const postData = JSON.stringify({
      url: url,
      videoQuality: "max",
      filenameStyle: "pretty",
    });

    const options = {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
      timeout: COBALT_TIMEOUT,
    };

    const req = https.request(COBALT_API_URL, options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          if (data.status === "error") {
            console.error("[Strategy 2: Cobalt] API error:", data.error?.code || body);
            return reject(new Error(data.error?.code || "Cobalt API error"));
          }
          console.log("[Strategy 2: Cobalt] SUCCESS — status:", data.status);
          resolve({ data, strategy: "cobalt" });
        } catch (e) {
          console.error("[Strategy 2: Cobalt] Parse error:", e.message);
          reject(new Error("Failed to parse Cobalt response"));
        }
      });
    });

    req.on("error", (e) => {
      console.error("[Strategy 2: Cobalt] Network error:", e.message);
      reject(e);
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Cobalt API timeout"));
    });

    req.write(postData);
    req.end();
  });
}

// ── STRATEGY 3: Invidious API (Last Resort) ───────────────────────────────────
function fetchWithInvidious(videoId) {
  return new Promise((resolve, reject) => {
    console.log("[Strategy 3: Invidious] Attempting fetch for ID:", videoId);

    let attempted = 0;

    function tryInstance(index) {
      if (index >= INVIDIOUS_INSTANCES.length) {
        return reject(new Error("All Invidious instances failed"));
      }

      const instance = INVIDIOUS_INSTANCES[index];
      const apiUrl = `${instance}/api/v1/videos/${videoId}?fields=title,videoThumbnails,lengthSeconds,author,viewCount,likeCount,description,adaptiveFormats,formatStreams`;

      console.log(`[Strategy 3: Invidious] Trying instance: ${instance}`);

      const protocol = apiUrl.startsWith("https") ? https : http;

      const req = protocol.get(apiUrl, { timeout: 15000 }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            console.error(`[Strategy 3: Invidious] Instance ${instance} returned ${res.statusCode}`);
            return tryInstance(index + 1);
          }
          try {
            const data = JSON.parse(body);
            if (data.error) {
              console.error(`[Strategy 3: Invidious] Instance ${instance} error:`, data.error);
              return tryInstance(index + 1);
            }
            console.log("[Strategy 3: Invidious] SUCCESS from", instance, "— title:", data.title);
            resolve({ data, strategy: "invidious", instance });
          } catch (e) {
            console.error(`[Strategy 3: Invidious] Parse error from ${instance}:`, e.message);
            tryInstance(index + 1);
          }
        });
      });

      req.on("error", (e) => {
        console.error(`[Strategy 3: Invidious] Network error from ${instance}:`, e.message);
        tryInstance(index + 1);
      });

      req.on("timeout", () => {
        req.destroy();
        console.error(`[Strategy 3: Invidious] Timeout from ${instance}`);
        tryInstance(index + 1);
      });
    }

    tryInstance(0);
  });
}

// ── Normalize: Convert yt-dlp data to unified response ───────────────────────
function normalizeYtdlpResponse(data) {
  const videoFormats = [];
  const seenQualities = new Set();

  if (data.formats) {
    const sorted = data.formats
      .filter((f) => f.height && f.url && f.ext)
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    for (const f of sorted) {
      const quality = `${f.height}p`;
      if (!seenQualities.has(quality)) {
        seenQualities.add(quality);
        videoFormats.push({
          format_id: f.format_id || null,
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
          format_id: f.format_id || null,
          bitrate,
          ext: f.ext,
          url: f.url,
          filesize: f.filesize || f.filesize_approx || null,
          acodec: f.acodec,
        });
      }
    }
  }

  return {
    title: data.title || "Untitled",
    thumbnail: data.thumbnail || null,
    duration: data.duration || 0,
    duration_string: data.duration_string || "0:00",
    uploader: data.uploader || data.channel || "Unknown",
    view_count: data.view_count || 0,
    like_count: data.like_count || 0,
    description: data.description ? data.description.substring(0, 300) : "",
    webpage_url: data.webpage_url || "",
    videoFormats,
    audioFormats,
    strategy: "yt-dlp",
  };
}

// ── Normalize: Convert Cobalt response to unified response ───────────────────
function normalizeCobaltResponse(data, originalUrl) {
  // Cobalt returns either a direct URL or a picker with multiple options
  const videoFormats = [];
  const audioFormats = [];

  if (data.status === "redirect" || data.status === "tunnel") {
    // Single direct download URL
    videoFormats.push({
      format_id: "cobalt-best",
      quality: "Best",
      height: 1080,
      ext: "mp4",
      url: data.url,
      filesize: null,
      vcodec: "h264",
      acodec: "aac",
      fps: null,
      format_note: "Cobalt Best Quality",
      cobalt_url: data.url,
    });
  } else if (data.status === "picker" && data.picker) {
    // Multiple options from cobalt
    data.picker.forEach((item, i) => {
      if (item.type === "video" || !item.type) {
        videoFormats.push({
          format_id: `cobalt-${i}`,
          quality: "Best",
          height: 1080,
          ext: "mp4",
          url: item.url,
          filesize: null,
          vcodec: "h264",
          acodec: "aac",
          fps: null,
          format_note: "Cobalt",
          cobalt_url: item.url,
        });
      }
    });
  }

  return {
    title: data.filename || "Video",
    thumbnail: null,
    duration: 0,
    duration_string: "—",
    uploader: "Unknown",
    view_count: 0,
    like_count: 0,
    description: "",
    webpage_url: originalUrl,
    videoFormats,
    audioFormats,
    strategy: "cobalt",
  };
}

// ── Normalize: Convert Invidious response to unified response ────────────────
function normalizeInvidiousResponse(data) {
  const videoFormats = [];
  const seenQualities = new Set();
  const audioFormats = [];
  const seenAudioBitrates = new Set();

  // formatStreams = muxed (video+audio) streams
  if (data.formatStreams) {
    for (const f of data.formatStreams) {
      const quality = f.qualityLabel || f.quality || "unknown";
      const height = parseInt(quality) || 0;
      if (height && !seenQualities.has(quality)) {
        seenQualities.add(quality);
        videoFormats.push({
          format_id: f.itag?.toString() || null,
          quality,
          height,
          ext: f.container || "mp4",
          url: f.url,
          filesize: null,
          vcodec: f.encoding || "unknown",
          acodec: f.audioEncoding || "aac",
          fps: f.fps || null,
          format_note: f.type || "",
        });
      }
    }
  }

  // adaptiveFormats = separate video-only and audio-only streams
  if (data.adaptiveFormats) {
    const sorted = [...data.adaptiveFormats].sort((a, b) => {
      const hA = parseInt(a.qualityLabel) || 0;
      const hB = parseInt(b.qualityLabel) || 0;
      return hB - hA;
    });

    for (const f of sorted) {
      if (f.type && f.type.startsWith("video/")) {
        const quality = f.qualityLabel || "unknown";
        const height = parseInt(quality) || 0;
        if (height && !seenQualities.has(quality)) {
          seenQualities.add(quality);
          videoFormats.push({
            format_id: f.itag?.toString() || null,
            quality,
            height,
            ext: f.container || "mp4",
            url: f.url,
            filesize: parseInt(f.clen) || null,
            vcodec: f.encoding || "unknown",
            acodec: "none",
            fps: f.fps || null,
            format_note: f.qualityLabel || "",
          });
        }
      } else if (f.type && f.type.startsWith("audio/")) {
        const bitrate = f.bitrate ? `${Math.round(parseInt(f.bitrate) / 1000)}kbps` : "unknown";
        if (bitrate !== "unknown" && !seenAudioBitrates.has(bitrate)) {
          seenAudioBitrates.add(bitrate);
          audioFormats.push({
            format_id: f.itag?.toString() || null,
            bitrate,
            ext: f.container || "webm",
            url: f.url,
            filesize: parseInt(f.clen) || null,
            acodec: f.encoding || f.audioCodec || "opus",
          });
        }
      }
    }
  }

  // Sort video formats by height descending
  videoFormats.sort((a, b) => b.height - a.height);

  // Get best thumbnail
  let thumbnail = null;
  if (data.videoThumbnails && data.videoThumbnails.length > 0) {
    const best = data.videoThumbnails.find((t) => t.quality === "maxresdefault") ||
                 data.videoThumbnails.find((t) => t.quality === "sddefault") ||
                 data.videoThumbnails[0];
    thumbnail = best?.url || null;
  }

  const duration = data.lengthSeconds || 0;
  const mins = Math.floor(duration / 60);
  const secs = duration % 60;
  const duration_string = `${mins}:${secs.toString().padStart(2, "0")}`;

  return {
    title: data.title || "Untitled",
    thumbnail,
    duration,
    duration_string,
    uploader: data.author || "Unknown",
    view_count: data.viewCount || 0,
    like_count: data.likeCount || 0,
    description: data.description ? data.description.substring(0, 300) : "",
    webpage_url: `https://www.youtube.com/watch?v=${data.videoId || ""}`,
    videoFormats,
    audioFormats,
    strategy: "invidious",
  };
}

// ── API: Fetch video info (Multi-Strategy) ────────────────────────────────────
app.get("/api/video", apiLimiter, async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ error: "No URL provided" });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({ error: "Invalid or disallowed URL" });
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`[API] Fetching video info for: ${url}`);
  console.log(`${"=".repeat(60)}`);

  // Strategy 1: yt-dlp
  try {
    const result = await fetchWithYtdlp(url);
    const response = normalizeYtdlpResponse(result.data);
    response.strategy = "yt-dlp";
    return res.json(response);
  } catch (ytdlpError) {
    console.log("[API] yt-dlp failed, trying Cobalt...");
  }

  // Strategy 2: Cobalt API
  try {
    const result = await fetchWithCobalt(url);
    const response = normalizeCobaltResponse(result.data, url);
    response.strategy = "cobalt";
    return res.json(response);
  } catch (cobaltError) {
    console.log("[API] Cobalt failed, trying Invidious...");
  }

  // Strategy 3: Invidious API (YouTube only)
  const videoId = extractYouTubeId(url);
  if (videoId) {
    try {
      const result = await fetchWithInvidious(videoId);
      const response = normalizeInvidiousResponse(result.data);
      response.strategy = "invidious";
      return res.json(response);
    } catch (invidiousError) {
      console.log("[API] Invidious also failed.");
    }
  }

  // All strategies failed
  console.error("[API] ALL STRATEGIES FAILED for:", url);
  return res.status(500).json({
    error: "Unable to fetch video info. All download strategies failed. Please try again in a few minutes or try a different URL.",
  });
});

// ── API: Download file via proxy (with security checks) ─────────────────────
app.get("/api/download", downloadLimiter, (req, res) => {
  const fileUrl = req.query.url;
  const videoUrl = req.query.video_url;
  const formatId = req.query.format_id;
  const filename = req.query.filename || "video";
  const ext = req.query.ext || "mp4";
  const acodec = req.query.acodec;
  const filesize = req.query.filesize;
  const strategy = req.query.strategy;

  if (!fileUrl && !videoUrl) {
    return res.status(400).json({ error: "No URL provided" });
  }

  if (fileUrl && !isValidUrl(fileUrl)) {
    return res.status(400).json({ error: "Invalid download URL" });
  }

  if (videoUrl && !isValidUrl(videoUrl)) {
    return res.status(400).json({ error: "Invalid video URL" });
  }

  const allowedExts = ["mp4", "webm", "mkv", "mp3", "m4a", "ogg", "opus", "wav", "flac", "aac"];
  const safeExt = allowedExts.includes(ext.toLowerCase()) ? ext.toLowerCase() : "mp4";

  const sanitizedFilename = filename
    .replace(/[^a-zA-Z0-9_\-\s]/g, "")
    .substring(0, 100)
    .trim() || "download";

  console.log(`[API] Download requested: filename="${sanitizedFilename}.${safeExt}" strategy=${strategy || "direct"}`);

  // ── Cobalt / Invidious direct URL download path ──────────────────────────
  // If the download URL is from cobalt or invidious, proxy the download directly
  if (strategy === "cobalt" || strategy === "invidious") {
    console.log(`[API] Proxying download from ${strategy} URL...`);

    const targetUrl = fileUrl || videoUrl;

    res.setHeader("Content-Disposition", `attachment; filename="${sanitizedFilename}.${safeExt}"`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");

    const protocol = targetUrl.startsWith("https") ? https : http;

    const proxyReq = protocol.get(targetUrl, { timeout: 120000 }, (proxyRes) => {
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        // Follow redirect
        const redirectProtocol = proxyRes.headers.location.startsWith("https") ? https : http;
        redirectProtocol.get(proxyRes.headers.location, { timeout: 120000 }, (redirectRes) => {
          if (redirectRes.headers["content-length"]) {
            res.setHeader("Content-Length", redirectRes.headers["content-length"]);
          }
          redirectRes.pipe(res);
        }).on("error", (e) => {
          console.error("[API] Redirect proxy error:", e.message);
          if (!res.headersSent) res.status(500).json({ error: "Download failed" });
        });
        return;
      }

      if (proxyRes.headers["content-length"]) {
        res.setHeader("Content-Length", proxyRes.headers["content-length"]);
      }
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (e) => {
      console.error("[API] Proxy download error:", e.message);
      if (!res.headersSent) res.status(500).json({ error: "Download failed" });
    });

    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      if (!res.headersSent) res.status(504).json({ error: "Download timeout" });
    });

    req.on("close", () => {
      proxyReq.destroy();
    });

    return;
  }

  // ── yt-dlp: HIGH-QUALITY MERGING PATH ────────────────────────────────────
  if (videoUrl && formatId && acodec === "none") {
    console.log(`[API] Video-only format detected (${formatId}). Merging with best audio on server...`);

    const tempDir = path.join(__dirname, "temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const safeId = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    const tempOutputPath = path.join(tempDir, `merged_${safeId}.mp4`);

    const spawnArgs = [
      "-f", `${formatId}+bestaudio/best`,
      "--merge-output-format", "mp4",
      "-o", tempOutputPath,
      "--no-warnings",
      "--extractor-args", "youtube:player-client=mediaconnect,web"
    ];

    const localFfmpeg = path.join(__dirname, "ffmpeg");
    if (fs.existsSync(localFfmpeg)) {
      spawnArgs.push("--ffmpeg-location", localFfmpeg);
    }

    spawnArgs.push(videoUrl);

    const child = execFile(
      YTDLP_CMD,
      spawnArgs,
      { maxBuffer: 1024 * 1024 * 10, timeout: 600000 },
      (error, stdout, stderr) => {
        if (error) {
          console.error("[API] Merging error:", stderr || error.message);
          try { fs.unlinkSync(tempOutputPath); } catch {}
          if (!res.headersSent) {
            return res.status(500).json({ error: "Failed to download and merge high-quality video and audio formats." });
          }
          return;
        }

        if (fs.existsSync(tempOutputPath)) {
          res.download(tempOutputPath, `${sanitizedFilename}.${safeExt}`, (err) => {
            try { fs.unlinkSync(tempOutputPath); } catch (e) {}
            if (err) {
              console.error("[API] Error sending merged file:", err.message);
            } else {
              console.log("[API] High-quality merged file downloaded successfully.");
            }
          });
        } else {
          if (!res.headersSent) {
            res.status(500).json({ error: "Merged file not found on server." });
          }
        }
      }
    );

    req.on("close", () => {
      console.log("[API] Client disconnected during high-quality merge. Killing process.");
      try { child.kill(); } catch {}
      setTimeout(() => {
        try { fs.unlinkSync(tempOutputPath); } catch {}
      }, 2000);
    });

  } else {
    // ── yt-dlp: STANDARD DIRECT-STREAMING PATH ──────────────────────────────
    res.setHeader("Content-Disposition", `attachment; filename="${sanitizedFilename}.${safeExt}"`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    if (filesize) {
      res.setHeader("Content-Length", filesize);
    }

    let spawnArgs = [];

    if (videoUrl && formatId) {
      console.log(`[API] Streaming video URL using format_id: ${formatId}`);
      spawnArgs = ["-f", formatId, "-o", "-", "--no-warnings", "--extractor-args", "youtube:player-client=mediaconnect,web"];
      spawnArgs.push(videoUrl);
    } else {
      const targetUrl = fileUrl || videoUrl;
      console.log(`[API] Streaming direct URL: ${targetUrl.substring(0, 80)}...`);
      spawnArgs = ["-o", "-", "--no-warnings", "--extractor-args", "youtube:player-client=mediaconnect,web"];
      spawnArgs.push(targetUrl);
    }

    const { spawn } = require("child_process");
    const child = spawn(YTDLP_CMD, spawnArgs);

    child.stdout.pipe(res);

    child.stderr.on("data", (data) => {
      console.error("[yt-dlp download stderr]:", data.toString().trim());
    });

    child.on("close", (code) => {
      console.log(`[API] Download stream closed with code: ${code}`);
    });

    req.on("close", () => {
      console.log("[API] Download client disconnected, killing stream process.");
      child.kill();
    });
  }
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

  const safeId = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  const outputPath = path.join(__dirname, "temp", `audio_${safeId}.mp3`);

  const tempDir = path.join(__dirname, "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const spawnArgs = [
    "-x", "--audio-format", "mp3", "--audio-quality", "0",
    "--no-exec", "--no-batch-file",
    "--extractor-args", "youtube:player-client=mediaconnect,web"
  ];
  const localFfmpeg = path.join(__dirname, "ffmpeg");
  if (fs.existsSync(localFfmpeg)) {
    spawnArgs.push("--ffmpeg-location", localFfmpeg);
  }
  spawnArgs.push("-o", outputPath, url);

  execFile(
    YTDLP_CMD,
    spawnArgs,
    { maxBuffer: 1024 * 1024 * 10, timeout: 300000 },
    (error, stdout, stderr) => {
      if (error) {
        console.error("Audio extraction error:", stderr || error.message);
        try { fs.unlinkSync(outputPath); } catch {}
        return res.status(500).json({ error: "Failed to extract audio" });
      }

      if (fs.existsSync(outputPath)) {
        res.download(outputPath, "audio.mp3", (err) => {
          try { fs.unlinkSync(outputPath); } catch (e) {}
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
      if (now - stat.mtimeMs > 10 * 60 * 1000) {
        fs.unlinkSync(filePath);
      }
    } catch {}
  }
}, 5 * 60 * 1000);

// ── Health check endpoint ────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  execFile(YTDLP_CMD, ["--version"], { timeout: 10000 }, (error, stdout) => {
    res.json({
      status: "ok",
      ytdlp: error ? "not available" : stdout.trim(),
      node: process.version,
      uptime: process.uptime(),
      strategies: ["yt-dlp", "cobalt", "invidious"],
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
  console.log(`🎯 Strategies: yt-dlp → Cobalt → Invidious`);

  execFile(YTDLP_CMD, ["--version"], { timeout: 10000 }, (error, stdout) => {
    if (error) {
      console.error("⚠️  yt-dlp is NOT available! Will rely on Cobalt/Invidious fallbacks.");
      console.error("   Error:", error.message);
    } else {
      console.log(`✅ yt-dlp version: ${stdout.trim()}`);
    }
  });
});
