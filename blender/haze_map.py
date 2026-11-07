"""
Builds the soft green "atmosphere" map used behind the DNA in the web compositor.

    python blender/haze_map.py /path/to/frames public/media/dna-haze.png

It averages every rendered frame (so the glow follows the helix's real envelope over the
whole loop), keeps the luminance, blurs it at two radii and normalises it. The page adds it,
tinted green and gently breathing, underneath the video.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

W, H = 160, 100


def main():
    frames_dir, out = Path(sys.argv[1]), Path(sys.argv[2])
    files = sorted(frames_dir.glob("frame_*.png"))
    if not files:
        raise SystemExit(f"no frames in {frames_dir}")
    acc = np.zeros((H * 4, W * 4), dtype=np.float64)
    for f in files[:: max(1, len(files) // 48)]:
        im = Image.open(f).convert("RGB").resize((W * 4, H * 4), Image.BILINEAR)
        a = np.asarray(im, dtype=np.float64) / 255.0
        acc += 0.25 * a[..., 0] + 0.6 * a[..., 1] + 0.15 * a[..., 2]
    acc /= len(files[:: max(1, len(files) // 48)])

    base = Image.fromarray((np.clip(acc / acc.max(), 0, 1) * 255).astype(np.uint8)).resize((W, H), Image.LANCZOS)
    near = np.asarray(base.filter(ImageFilter.GaussianBlur(7)), dtype=np.float64)
    far = np.asarray(base.filter(ImageFilter.GaussianBlur(20)), dtype=np.float64)
    haze = 0.55 * near + 0.45 * far
    haze /= np.percentile(haze, 99.5)
    haze = np.clip(haze, 0, 1) ** 0.85
    Image.fromarray((haze * 255).astype(np.uint8), "L").save(out, optimize=True)
    print(f"wrote {out} from {len(files)} frames")


if __name__ == "__main__":
    main()
