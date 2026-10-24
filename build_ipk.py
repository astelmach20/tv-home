#!/usr/bin/env python3
"""Package app/org.tvhome.launcher into an IPK (GNU ar: debian-binary, control.tar.gz, data.tar.gz)."""
import io, json, os, sys, tarfile, time

ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ROOT, 'app', 'org.tvhome.launcher')
info = json.load(open(os.path.join(APP, 'appinfo.json')))
app_id, version = info['id'], info['version']


def targz(add):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz', format=tarfile.GNU_FORMAT) as t:
        add(t)
    return buf.getvalue()


def add_bytes(t, name, data, mode=0o644):
    ti = tarfile.TarInfo(name)
    ti.size, ti.mode, ti.mtime = len(data), mode, int(time.time())
    t.addfile(ti, io.BytesIO(data))


def add_dir(t, name):
    ti = tarfile.TarInfo(name)
    ti.type, ti.mode, ti.mtime = tarfile.DIRTYPE, 0o755, int(time.time())
    t.addfile(ti)


control = f"""Package: {app_id}
Version: {version}
Section: misc
Priority: optional
Architecture: all
Maintainer: tvhome
Description: {info['title']}
webOS-Package-Format-Version: 2
webOS-Packager-Version: x.y.x
"""


def data(t):
    base = f'./usr/palm/applications/{app_id}'
    for d in ['./usr', './usr/palm', './usr/palm/applications', base]:
        add_dir(t, d)
    for f in sorted(os.listdir(APP)):
        add_bytes(t, f'{base}/{f}', open(os.path.join(APP, f), 'rb').read())
    pkg = {'app': app_id, 'id': app_id, 'loc_name': info['title'], 'package_format_version': 2, 'vendor': info['vendor'], 'version': version}
    add_dir(t, './usr/palm/packages')
    add_dir(t, f'./usr/palm/packages/{app_id}')
    add_bytes(t, f'./usr/palm/packages/{app_id}/packageinfo.json', json.dumps(pkg).encode())


members = [
    ('debian-binary', b'2.0\n'),
    ('control.tar.gz', targz(lambda t: add_bytes(t, './control', control.encode()))),
    ('data.tar.gz', targz(data)),
]

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, f'{app_id}_{version}_all.ipk')
with open(out, 'wb') as f:
    f.write(b'!<arch>\n')
    for name, body in members:
        hdr = f'{name + "/":<16}{int(time.time()):<12}{0:<6}{0:<6}{0o100644:<8o}{len(body):<10}`\n'
        f.write(hdr.encode())
        f.write(body)
        if len(body) % 2:
            f.write(b'\n')
print(out)
