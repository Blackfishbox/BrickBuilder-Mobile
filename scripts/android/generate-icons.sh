#!/usr/bin/env bash
# Rebuild transparent legacy and adaptive launcher resources from the shared icon.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="$ROOT/artifacts/brickbuilder-mobile/public/icons/brickbuilder-512.png"
RES="$ROOT/artifacts/brickbuilder-mobile/android/app/src/main/res"
command -v magick >/dev/null || { echo "ImageMagick 7 (magick) is required." >&2; exit 1; }
for spec in mdpi:48:108:60 hdpi:72:162:90 xhdpi:96:216:120 xxhdpi:144:324:180 xxxhdpi:192:432:240; do
  IFS=: read -r density legacy canvas content <<< "$spec"
  target="$RES/mipmap-$density"
  mkdir -p "$target"
  for name in ic_launcher ic_launcher_round; do
    magick "$SOURCE" -resize "${legacy}x${legacy}" -strip "PNG32:$target/$name.png"
  done
  # Adaptive masks animate/crop a 108dp canvas. Keep the artwork in its safe area.
  magick "$SOURCE" -trim +repage -resize "${content}x${content}" \
    -gravity center -background none -extent "${canvas}x${canvas}" -strip \
    "PNG32:$target/ic_launcher_foreground.png"
done
echo "Launcher icons regenerated with alpha transparency at all five densities."
