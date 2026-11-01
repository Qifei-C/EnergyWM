"""Convert the YCB banana scan (011_banana, Google 16k textured OBJ) into assets/banana.glb.

Source: YCB Object and Model Set (Calli et al.), CC BY 4.0 — https://www.ycbbenchmarks.com
Changes made here: re-oriented (long axis → +x, thickness → +z), pivot moved to the fruit's midline
at mid-length, vertices de-duplicated per (position, uv, normal), texture resized to 1024 px JPEG.

Usage: python3 -I scripts/convert_banana.py <dir with textured.obj and texture_map.png> <out.glb>
(see scripts/fetch_banana.sh)
"""
import io
import json
import struct
import sys

import numpy as np
from PIL import Image


def load_obj(path):
    V, VT, VN, F = [], [], [], []
    with open(path) as fh:
        for line in fh:
            p = line.split()
            if not p:
                continue
            if p[0] == 'v':
                V.append([float(x) for x in p[1:4]])
            elif p[0] == 'vt':
                VT.append([float(x) for x in p[1:3]])
            elif p[0] == 'vn':
                VN.append([float(x) for x in p[1:4]])
            elif p[0] == 'f':
                idx = []
                for tok in p[1:]:
                    a = tok.split('/')
                    vi = int(a[0]) - 1
                    ti = int(a[1]) - 1 if len(a) > 1 and a[1] else -1
                    ni = int(a[2]) - 1 if len(a) > 2 and a[2] else -1
                    idx.append((vi, ti, ni))
                for k in range(1, len(idx) - 1):  # fan triangulation
                    F.append((idx[0], idx[k], idx[k + 1]))
    return np.array(V), np.array(VT), np.array(VN), F


def main(src, out):
    V, VT, VN, F = load_obj(src + '/textured.obj')
    # unique (v, vt, vn) corners
    key_to_new, pos, uv, nrm, tris = {}, [], [], [], []
    for tri in F:
        t = []
        for c in tri:
            if c not in key_to_new:
                key_to_new[c] = len(pos)
                pos.append(V[c[0]])
                uv.append(VT[c[1]] if c[1] >= 0 else (0.0, 0.0))
                nrm.append(VN[c[2]] if c[2] >= 0 else (0.0, 0.0, 1.0))
            t.append(key_to_new[c])
        tris.append(t)
    pos, uv, nrm, tris = np.array(pos), np.array(uv), np.array(nrm), np.array(tris, dtype=np.uint32)
    # principal axes: longest → x, thinnest → z
    c = pos.mean(0)
    w, e = np.linalg.eigh(np.cov((pos - c).T))
    order = np.argsort(w)[::-1]
    R = e[:, order].T  # rows = new x, y, z
    if np.linalg.det(R) < 0:
        R[1] *= -1
    # keep the scan's upward direction (its +z) pointing up after the rotation
    if R[2, 2] < 0:
        R[2] *= -1
        R[1] *= -1
    p2 = (pos - c) @ R.T
    n2 = nrm @ R.T
    n2 /= np.linalg.norm(n2, axis=1, keepdims=True) + 1e-12
    lo, hi = p2.min(0), p2.max(0)
    # pivot: on the fruit's own midline at mid-length (a curved banana's bbox centre lies in the air)
    p2[:, 0] -= (lo[0] + hi[0]) / 2
    mid = np.abs(p2[:, 0]) < 0.012
    p2[:, 1] -= p2[mid, 1].mean()
    p2[:, 2] -= (lo[2] + hi[2]) / 2
    lo, hi = p2.min(0), p2.max(0)
    uv = uv.copy(); uv[:, 1] = 1.0 - uv[:, 1]  # OBJ (bottom-left origin) → glTF (top-left origin)
    print('extent (m):', np.round(hi - lo, 4), 'verts', len(p2), 'tris', len(tris))
    # texture
    img = Image.open(src + '/texture_map.png').convert('RGB').resize((1024, 1024), Image.LANCZOS)
    jb = io.BytesIO(); img.save(jb, 'JPEG', quality=88); jpg = jb.getvalue()
    # GLB
    blobs, views, acc = [], [], []

    def add(data, target=None):
        off = sum(len(b) for b in blobs)
        pad = (-len(data)) % 4
        blobs.append(data + b'\0' * pad)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            v['target'] = target
        views.append(v)
        return len(views) - 1

    def accessor(arr, ctype, typ, target, minmax=False):
        bv = add(arr.tobytes(), target)
        a = {'bufferView': bv, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
        if minmax:
            a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
        acc.append(a)
        return len(acc) - 1

    ip = accessor(p2.astype(np.float32), 5126, 'VEC3', 34962, True)
    inn = accessor(n2.astype(np.float32), 5126, 'VEC3', 34962)
    it = accessor(uv.astype(np.float32), 5126, 'VEC2', 34962)
    ii = accessor(tris.reshape(-1).astype(np.uint32), 5125, 'SCALAR', 34963)
    ib = add(jpg)
    gl = {
        'asset': {'version': '2.0', 'generator': 'EnergyWM convert_banana.py',
                  'copyright': 'YCB Object and Model Set (011_banana), CC BY 4.0; modified'},
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': 'banana'}],
        'meshes': [{'primitives': [{'attributes': {'POSITION': ip, 'NORMAL': inn, 'TEXCOORD_0': it}, 'indices': ii, 'material': 0}]}],
        'materials': [{'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': 0.55}}],
        'textures': [{'source': 0, 'sampler': 0}], 'samplers': [{}],
        'images': [{'bufferView': ib, 'mimeType': 'image/jpeg'}],
        'buffers': [{'byteLength': sum(len(b) for b in blobs)}],
        'bufferViews': views, 'accessors': acc,
    }
    js = json.dumps(gl, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    binb = b''.join(blobs)
    total = 12 + 8 + len(js) + 8 + len(binb)
    with open(out, 'wb') as fh:
        fh.write(struct.pack('<III', 0x46546C67, 2, total))
        fh.write(struct.pack('<II', len(js), 0x4E4F534A)); fh.write(js)
        fh.write(struct.pack('<II', len(binb), 0x004E4942)); fh.write(binb)
    print('wrote', out, total, 'bytes; x', np.round([lo[0], hi[0]], 4), 'y', np.round([lo[1], hi[1]], 4), 'z', np.round([lo[2], hi[2]], 4))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
