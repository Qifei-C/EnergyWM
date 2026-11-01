#!/usr/bin/env bash
# Download the Franka Panda visual meshes from mujoco_menagerie (Apache-2.0) and rebuild assets/panda.glb + panda_kin.json.
set -euo pipefail
cd "$(dirname "$0")/../assets/panda_src"
BASE=https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/main/franka_emika_panda
curl -sSf -o panda.xml $BASE/panda.xml
curl -sSf -o LICENSE $BASE/LICENSE
python3 - <<'PY'
import xml.etree.ElementTree as ET
t = ET.parse('panda.xml').getroot()
files = [m.get('file') for m in t.iter('mesh') if m.get('file')]
open('visual_meshes.txt','w').write('\n'.join(f for f in files if f.endswith('.obj') and 'collision' not in f))
PY
xargs -P 6 -I{} sh -c "curl -sSf -o {} $BASE/assets/{}" < visual_meshes.txt
python3 ../../scripts/convert_panda.py
