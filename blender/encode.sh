#!/usr/bin/env bash
# Encodes the rendered Blender frames into the web loops used by the hero.
#
#   ./blender/encode.sh /path/to/frames [public/media]
#
# Produces (1440×900 and 960×600, 24 fps, seamless 8 s loop):
#   dna-loop-1440.webm / .mp4, dna-loop-960.webm / .mp4, dna-poster.jpg
set -euo pipefail

FRAMES="${1:?usage: encode.sh <frames-dir> [out-dir]}"
OUT="${2:-public/media}"
mkdir -p "$OUT"

IN=(-framerate 24 -i "$FRAMES/frame_%04d.png")

for size in 1440 960; do
  if [ "$size" = 1440 ]; then scale="scale=1440:900"; vp9_crf=36; x264_crf=25; else scale="scale=960:600:flags=lanczos"; vp9_crf=35; x264_crf=24; fi

  ffmpeg -y -v error "${IN[@]}" -vf "$scale" -an \
    -c:v libvpx-vp9 -b:v 0 -crf "$vp9_crf" -row-mt 1 -deadline good -cpu-used 2 \
    -g 48 -pix_fmt yuv420p "$OUT/dna-loop-$size.webm"

  ffmpeg -y -v error "${IN[@]}" -vf "$scale" -an \
    -c:v libx264 -preset slow -crf "$x264_crf" -profile:v high -level 4.0 \
    -g 48 -pix_fmt yuv420p -movflags +faststart "$OUT/dna-loop-$size.mp4"
done

ffmpeg -y -v error -i "$FRAMES/frame_0000.png" -q:v 3 "$OUT/dna-poster.jpg"
ls -la "$OUT"
