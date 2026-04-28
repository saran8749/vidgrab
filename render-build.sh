#!/bin/bash
# Render.com Build Script for VidGrab
# Installs Node.js dependencies and yt-dlp

echo "📦 Installing Node.js dependencies..."
npm install

echo "🎬 Installing yt-dlp..."
pip install --upgrade yt-dlp || pip3 install --upgrade yt-dlp || {
  echo "⚠️ pip not found, downloading yt-dlp binary..."
  curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  chmod a+rx /usr/local/bin/yt-dlp
}

echo "✅ Build complete!"
yt-dlp --version || echo "⚠️ yt-dlp version check failed"
