"""Build a reproducible, offline English-Chinese dictionary from licensed ECDICT data."""
import csv
import hashlib
import io
import json
import pathlib
import sqlite3
import urllib.request

root = pathlib.Path(__file__).resolve().parents[1]
destination = root / 'resources'
destination.mkdir(exist_ok=True)
url = 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv'
license_url = 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/LICENSE'
with urllib.request.urlopen(license_url, timeout=30) as response:
    license_text = response.read().decode()
if 'MIT License' not in license_text:
    raise RuntimeError('Upstream license requires review')
(destination / 'ECDICT-LICENSE.txt').write_text(license_text)
db = sqlite3.connect(destination / 'dictionary.sqlite3')
db.execute('CREATE TABLE IF NOT EXISTS dictionary(word TEXT PRIMARY KEY,phonetic TEXT,definition TEXT,translation TEXT)')
count = 0
digest = hashlib.sha256()
with urllib.request.urlopen(url, timeout=90) as response:
    for line in io.TextIOWrapper(response, encoding='utf-8-sig'):
        digest.update(line.encode())
        # CSV descriptions are escaped as literal \\n, so rows are single-line.
        if count == 0 and line.startswith('word,'):
            columns = next(csv.reader([line]))
            continue
        values = next(csv.reader([line]))
        row = dict(zip(columns, values))
        def rank(key):
            try:
                return int(row.get(key) or 0)
            except ValueError:
                return 0
        common = (0 < rank('bnc') <= 25000) or (0 < rank('frq') <= 25000) or bool(row.get('oxford')) or bool(row.get('collins'))
        word = row.get('word', '').lower()
        if not common or not word or len(word) > 60:
            continue
        db.execute('INSERT OR REPLACE INTO dictionary VALUES(?,?,?,?)', (word, row.get('phonetic',''), row.get('definition','').replace('\\n','\n'), row.get('translation','').replace('\\n','\n')))
        count += 1
db.commit()
total = db.execute('SELECT count(*) FROM dictionary').fetchone()[0]
if total < 10000:
    raise RuntimeError(f'Unexpected dictionary size: {total}')
db.execute('VACUUM')
db.close()
(destination / 'dictionary-source.json').write_text(json.dumps({'source':url,'license':'MIT','source_sha256':digest.hexdigest(),'entries':total,'selection':'BNC or FRQ rank <= 25000, or Oxford/Collins marked'},ensure_ascii=False,indent=2))
print(f'Built offline dictionary: {total} entries')
