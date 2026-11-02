#!/usr/bin/env bash
# Fetch the YCB banana scan (011_banana, Google 16k textured mesh; CC BY 4.0) and convert it to assets/banana.glb.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; repo="$(dirname "$here")"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
curl -sSfL -o "$tmp/banana.tgz" "https://ycb-benchmarks.s3.amazonaws.com/data/google/011_banana_google_16k.tgz"
tar -xzf "$tmp/banana.tgz" -C "$tmp"
python3 -I "$here/convert_banana.py" "$tmp/011_banana/google_16k" "$repo/assets/banana.glb"
