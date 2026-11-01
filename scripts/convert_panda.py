"""Convert the menagerie Panda MJCF + OBJ meshes into assets/panda.glb (per-link nodes, meshes merged
per material, vertices merged) and assets/panda_kin.json (body pos/quat, joint axes and ranges).
Run from assets/panda_src after scripts/fetch_panda.sh has downloaded the meshes. Requires trimesh + numpy."""
import xml.etree.ElementTree as ET, json, numpy as np, trimesh, os
here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, '..', 'assets', 'panda_src')
os.chdir(src)
t = ET.parse('panda.xml').getroot()
mats = {m.get('name'): [float(v) for v in m.get('rgba').split()] for m in t.iter('material') if m.get('name')}
meshfile = {m.get('name') or m.get('file').split('.')[0]: m.get('file') for m in t.iter('mesh')}
defaults = {}
for d in t.iter('default'):
    j = d.find('joint')
    if j is not None:
        defaults[d.get('class')] = dict(j.attrib)
links, scene = [], trimesh.Scene()
vec = lambda s, default: [float(v) for v in s.split()] if s else default
def walk(b, parent):
    name = b.get('name')
    pos, quat = vec(b.get('pos'), [0, 0, 0]), vec(b.get('quat'), [1, 0, 0, 0])
    joint = None
    j = b.find('joint')
    if j is not None:
        base = dict(defaults.get(j.get('class', 'panda'), {})); base.update(j.attrib)
        joint = {'name': base.get('name'), 'axis': vec(base.get('axis', '0 0 1'), None), 'type': base.get('type', 'hinge'),
                 'range': vec(base.get('range', '-3.14 3.14'), None)}
    links.append({'name': name, 'parent': parent, 'pos': pos, 'quat': quat, 'joint': joint})
    groups = {}
    for g in b.findall('geom'):
        if g.get('class') != 'visual' or not g.get('mesh'):
            continue
        m = trimesh.load(meshfile[g.get('mesh')], force='mesh', process=False)
        T = trimesh.transformations.quaternion_matrix(vec(g.get('quat'), [1, 0, 0, 0])); T[:3, 3] = vec(g.get('pos'), [0, 0, 0])
        m.apply_transform(T)
        groups.setdefault(g.get('material', 'white'), []).append(m)
    scene.graph.update(frame_to=name, frame_from='world', matrix=np.eye(4))
    for mat, ms in groups.items():
        mm = trimesh.util.concatenate(ms) if len(ms) > 1 else ms[0]
        mm.merge_vertices(); mm.visual = trimesh.visual.ColorVisuals(mm)
        scene.add_geometry(mm, node_name=f'{name}__{mat}', geom_name=f'{name}__{mat}', parent_node_name=name, transform=np.eye(4))
    for c in b.findall('body'):
        walk(c, name)
walk(t.find('worldbody').find('body'), None)
open('../panda.glb', 'wb').write(scene.export(file_type='glb'))
json.dump({'materials': mats, 'links': links}, open('../panda_kin.json', 'w'), indent=1)
print('wrote assets/panda.glb and assets/panda_kin.json;', sum(len(g.faces) for g in scene.geometry.values()), 'faces')
