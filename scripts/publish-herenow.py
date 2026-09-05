"""Publish dist/ to here.now.

    python3 scripts/publish-herenow.py            # create a new preview Site (fresh slug)
    python3 scripts/publish-herenow.py <slug>     # update an existing Site in place

Reads HERE_NOW_API_KEY from the environment or from .env. Uses only the
standard library. Flow: create/update -> PUT each presigned upload -> finalize.

here.now serves files with a one-hour cache, so index.html's `?v=` cache-busters are
stamped with the package version and the git commit at publish time. The source file
is not modified.
"""
import hashlib, json, mimetypes, os, re, subprocess, sys, urllib.request
from pathlib import Path

root = Path(__file__).resolve().parents[1]
dist = root / 'dist'
API = 'https://here.now/api/v1/publish'
TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.sid': 'audio/prs.sid', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json'}

def api_key():
    key = os.environ.get('HERE_NOW_API_KEY')
    if not key and (root / '.env').exists():
        for line in (root / '.env').read_text().splitlines():
            if line.startswith('HERE_NOW_API_KEY='):
                key = line.split('=', 1)[1].strip().strip('"\'')
    if not key:
        sys.exit('HERE_NOW_API_KEY is not set (environment or .env).')
    return key

def request(method, url, body=None, headers=None, raw=False):
    data = body if raw else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            payload = response.read()
            return json.loads(payload) if payload and not raw else payload
    except urllib.error.HTTPError as error:
        sys.exit(f'{method} {url} failed: {error.code} {error.read().decode(errors="replace")[:600]}')

def build_stamp():
    version = json.loads((root / 'package.json').read_text()).get('version', '0')
    try:
        sha = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True, cwd=root, check=True).stdout.strip()
        dirty = subprocess.run(['git', 'status', '--porcelain', 'dist'], capture_output=True, text=True, cwd=root).stdout.strip()
        return f'{version}-{sha}' + ('-dirty' if dirty else '')
    except Exception:
        return version

def main():
    slug = sys.argv[1] if len(sys.argv) > 1 else None
    key = api_key()
    auth = {'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}
    files, blobs = [], {}
    stamp = build_stamp()
    for path in sorted(p for p in dist.rglob('*') if p.is_file() and not p.name.startswith('.')):
        rel = path.relative_to(dist).as_posix()
        data = path.read_bytes()
        if rel == 'index.html':
            data = re.sub(rb'\?v=[0-9A-Za-z.\-]+', b'?v=' + stamp.encode(), data)
            print('cache-buster:', stamp)
        blobs[rel] = data
        files.append({'path': rel, 'size': len(data), 'hash': hashlib.sha256(data).hexdigest(), 'contentType': TYPES.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0] or 'application/octet-stream'})
    body = {'files': files, 'displayName': 'SID Observatory', 'displayDescription': 'A demoscene listening room and live SID voice inspector'}
    created = request('PUT' if slug else 'POST', f'{API}/{slug}' if slug else API, body, auth)
    upload = created['upload']
    print(f"{'Updating' if slug else 'Creating'} {created['slug']} -> {created['siteUrl']} ({len(upload['uploads'])} uploads, {len(upload.get('skipped', []))} unchanged)")
    for target in upload['uploads']:
        request(target['method'], target['url'], blobs[target['path']], target['headers'], raw=True)
        print('  uploaded', target['path'])
    final = request('POST', upload.get('finalizeUrl') or f"{API}/{created['slug']}/finalize", {'versionId': upload['versionId']}, auth)
    print('Live:', final['siteUrl'], '| version', final['currentVersionId'], '| unchanged' if final.get('unchanged') else '')
    for warning in final.get('warnings', []):
        print('WARNING:', warning)

if __name__ == '__main__':
    main()
