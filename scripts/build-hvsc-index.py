"""Build the browsable HVSC index shipped with the site.

    python3 scripts/build-hvsc-index.py                  # download Songlengths.md5 for the current release
    python3 scripts/build-hvsc-index.py --from FILE      # reuse a local copy

Output (all generated, committed, and pinned to one HVSC release):
  dist/hvsc/manifest.json        release, counts, shard names per top-level folder
  dist/hvsc/<TOP>-<SECOND>.json  nested folder tree with per-subtune song lengths (seconds)
  dist/hvsc/paths.txt            every file path, one per line, for in-browser search
  dist/hvsc/shelf.json           curated starter shelf, each entry verified against its PSID header

No tune is stored: the browser fetches each SID from hvsc.c64.org when the listener asks for it.
"""
import json, re, struct, sys, urllib.request, urllib.parse, datetime
from pathlib import Path

root = Path(__file__).resolve().parents[1]
out = root / 'dist' / 'hvsc'
BASE = 'https://hvsc.c64.org/download/C64Music'
SHELF = [
    ('/MUSICIANS/H/Hubbard_Rob/Commando.sid', 'The arcade conversion that made the SID famous.'),
    ('/MUSICIANS/H/Hubbard_Rob/Monty_on_the_Run.sid', 'Six minutes of relentless invention.'),
    ('/MUSICIANS/G/Galway_Martin/Wizball.sid', 'Filter sweeps and a legendary melody.'),
    ('/MUSICIANS/T/Tel_Jeroen/Cybernoid.sid', 'Maniacs of Noise at full tilt.'),
    ('/MUSICIANS/D/Daglish_Ben/Last_Ninja.sid', 'Atmosphere in three voices.'),
    ('/MUSICIANS/G/Gray_Matt/Last_Ninja_2.sid', 'Central Park never sounded like this.'),
    ('/MUSICIANS/H/Huelsbeck_Chris/R-Type.sid', 'Huelsbeck on the C64.'),
    ('/MUSICIANS/W/Whittaker_David/Lazy_Jones.sid', 'The loop that became a club hit.'),
    ('/MUSICIANS/G/Galway_Martin/Comic_Bakery.sid', 'Bright, bouncy, unmistakably Galway.'),
    ('/MUSICIANS/L/Laxity/Syncopated.sid', 'Demoscene groove from Vibrants.'),
    ('/MUSICIANS/J/Jammer/BBC_2SID.sid', 'Two chips, six voices.'),
    ('/MUSICIANS/S/Stinsen/Space_Monkeys_2SID.sid', 'A modern 2SID workout.'),
    ('/MUSICIANS/C/Chiummo_Gaetano/Arcade_Memories_3SID.sid', 'Three chips, nine voices, one arcade.'),
    ('/MUSICIANS/C/Chiummo_Gaetano/Hope_3SID.sid', 'Nine voices of quiet optimism.'),
]

def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'sid-observatory-index-builder'}), timeout=120) as response:
        return response.read()

def seconds(text):
    minutes, rest = text.split(':')
    return round(int(minutes) * 60 + float(rest), 1)

def parse_songlengths(text):
    entries, path = {}, None
    for line in text.splitlines():
        if line.startswith('; /'):
            path = line[2:].strip()
        elif path and re.match(r'^[0-9a-f]{32}=', line):
            entries[path] = [seconds(t) for t in line.split('=', 1)[1].split()]
            path = None
    return entries

def header_meta(data, path):
    if len(data) < 124 or data[:4] not in (b'PSID', b'RSID'):
        return None, 'not a SID file'
    magic = data[:4].decode(); version, = struct.unpack('>H', data[4:6]); play, = struct.unpack('>H', data[12:14]); songs, start = struct.unpack('>HH', data[14:18]); flags, = struct.unpack('>H', data[118:120])
    text = lambda at: data[at:at + 32].split(b'\0')[0].decode('latin1').strip()
    chips = 1 + (version >= 3 and data[122] >= 0x42 and not data[122] & 1 and (data[122] < 0x80 or data[122] >= 0xE0)) + (version >= 4 and data[123] >= 0x42 and not data[123] & 1 and (data[123] < 0x80 or data[123] >= 0xE0))
    meta = {'path': path, 'title': text(22) or Path(path).stem, 'author': text(54), 'released': text(86), 'chips': int(chips), 'songs': songs, 'start': max(start, 1) - 1}
    if magic == 'RSID': return meta, 'RSID'
    if flags & 3: return meta, 'MUS/PlaySID'
    if (flags >> 2) & 3 == 2: return meta, 'NTSC-only'
    if not play: return meta, 'zero play address'
    return meta, None

def main():
    source = None
    if '--from' in sys.argv:
        source = Path(sys.argv[sys.argv.index('--from') + 1]).read_text(encoding='latin1')
    else:
        source = fetch(BASE + '/DOCUMENTS/Songlengths.md5').decode('latin1')
    release = fetch(BASE + '/DOCUMENTS/hv_sids.txt').decode().strip().split()[-1]
    try:
        current = json.loads(fetch('https://hvsc.c64.org/api/v1/version/7z'))['version']
        if str(current) != release: print(f'NOTE: HVSC site reports release {current}; the download tree says {release}.')
    except Exception as error:
        print('Could not confirm the live release number:', error)
    entries = parse_songlengths(source)
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob('*'): old.unlink()
    shards, manifest = {}, {}
    for path, lengths in entries.items():
        parts = path.split('/')[1:]
        top, second, rest = parts[0], parts[1], parts[2:]
        manifest.setdefault(top, set()).add(second)
        node = shards.setdefault(f'{top}-{second}', {'path': f'/{top}/{second}', 'tree': {'folders': {}, 'files': {}}})['tree']
        for folder in rest[:-1]:
            node = node['folders'].setdefault(folder, {'folders': {}, 'files': {}})
        node['files'][rest[-1]] = lengths
    def sort_tree(node):
        return {'folders': {k: sort_tree(v) for k, v in sorted(node['folders'].items(), key=lambda kv: kv[0].lower())}, 'files': dict(sorted(node['files'].items(), key=lambda kv: kv[0].lower()))}
    for name, shard in shards.items():
        (out / f'{name}.json').write_text(json.dumps({'path': shard['path'], 'tree': sort_tree(shard['tree'])}, separators=(',', ':')))
    (out / 'paths.txt').write_text('\n'.join(sorted(entries, key=str.lower)) + '\n')
    shelf, rejected = [], []
    for path, note in SHELF:
        if path not in entries: rejected.append((path, 'not in this release')); continue
        meta, problem = header_meta(fetch(BASE + '/'.join(urllib.parse.quote(p) for p in path.split('/'))), path)
        if problem: rejected.append((path, problem)); continue
        shelf.append({**meta, 'lengths': entries[path], 'note': note})
    (out / 'shelf.json').write_text(json.dumps(shelf, indent=1, ensure_ascii=False))
    (out / 'manifest.json').write_text(json.dumps({'release': int(release), 'generated': datetime.date.today().isoformat(), 'files': len(entries), 'base': BASE, 'shards': {top: sorted(seconds_, key=str.lower) for top, seconds_ in sorted(manifest.items())}}, indent=1))
    total = sum(p.stat().st_size for p in out.glob('*'))
    print(f'HVSC release {release}: {len(entries)} files, {len(shards)} shards, {len(shelf)} shelf tunes, {total/1e6:.1f} MB under dist/hvsc')
    for path, why in rejected: print('  shelf rejected:', path, '-', why)

if __name__ == '__main__':
    main()
