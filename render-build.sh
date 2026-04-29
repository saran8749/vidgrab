#!/bin/bash
# Render.com Build Script for VidGrab
# Installs Node.js dependencies and yt-dlp

set -e

echo "📦 Installing Node.js dependencies..."
npm install

echo "🎬 Installing yt-dlp..."

# Try pip first (most reliable on Render)
if command -v pip3 &> /dev/null; then
  echo "Using pip3 to install yt-dlp..."
  pip3 install --upgrade yt-dlp
elif command -v pip &> /dev/null; then
  echo "Using pip to install yt-dlp..."
  pip install --upgrade yt-dlp
else
  echo "⚠️ pip not found, downloading yt-dlp binary..."
  # Download to project directory (always writable)
  curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ./yt-dlp
  chmod a+rx ./yt-dlp
  
  # Also try /usr/local/bin
  cp ./yt-dlp /usr/local/bin/yt-dlp 2>/dev/null || true
  
  # Add current directory to PATH for runtime
  export PATH="$PWD:$PATH"
fi

# Verify installation
echo ""
echo "🔍 Verifying yt-dlp installation..."
if command -v yt-dlp &> /dev/null; then
  echo "✅ yt-dlp version: $(yt-dlp --version)"
  echo "✅ yt-dlp location: $(which yt-dlp)"
elif [ -f "./yt-dlp" ]; then
  echo "✅ yt-dlp version: $(./yt-dlp --version)"
  echo "✅ yt-dlp location: ./yt-dlp (local)"
else
  echo "❌ yt-dlp installation FAILED!"
  exit 1
fi

echo ""
echo "✅ Build complete!"
