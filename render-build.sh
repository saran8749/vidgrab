#!/bin/bash
# Render.com Build Script for VidGrab
# Installs Node.js dependencies, yt-dlp binary (nightly), and ffmpeg binary

set -e

echo "📦 Installing Node.js dependencies..."
npm install

echo "🎬 Installing yt-dlp NIGHTLY binary locally..."
# Download nightly Linux yt-dlp binary — contains latest YouTube bypass patches
curl -L https://github.com/yt-dlp/yt-dlp/releases/download/nightly/yt-dlp -o ./yt-dlp
chmod a+rx ./yt-dlp

echo "🎙️ Installing ffmpeg binary locally..."
# Download static Linux-x64 ffmpeg binary directly to project root
curl -L https://github.com/eugeneware/ffmpeg-static/releases/download/b5.0.1/linux-x64 -o ./ffmpeg
chmod a+rx ./ffmpeg

# Verify installations
echo ""
echo "🔍 Verifying local installations..."
if [ -f "./yt-dlp" ]; then
  echo "✅ yt-dlp version: $(./yt-dlp --version)"
  echo "✅ yt-dlp location: ./yt-dlp (local nightly)"
else
  echo "❌ yt-dlp installation FAILED!"
  exit 1
fi

if [ -f "./ffmpeg" ]; then
  echo "✅ ffmpeg is present locally"
  chmod a+rx ./ffmpeg
else
  echo "❌ ffmpeg installation FAILED!"
  exit 1
fi

echo ""
echo "✅ Build complete!"
