"""Build the car pick's list from vehicle-makes-models (open data licence ODbL, built from autoevolution.com data).

Usage: python scripts/build_car_list.py /path/to/vehicles.sqlite

Writes data/car-list/index.json (every make, with its counts) and data/car-list/<make>.json (that make's models and
variants), so the pick downloads only the make chosen. Petrol, diesel, electric and hybrid engines are kept; gas,
ethanol and hydrogen engines are not. Run it again when the dataset is updated.
"""
import datetime
import json
import os
import re
import sqlite3
import sys
import unicodedata

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'data', 'car-list')
FUEL = {
    'Gasoline': 'Petrol',
    'Diesel': 'Diesel',
    'Electric': 'Electric',
    'Hybrid Gasoline': 'Hybrid',
    'Hybrid': 'Hybrid',
    'Plug-in Hybrid': 'Plug-in hybrid',
    'Mild Hybrid': 'Mild hybrid',
    'Mild Hybrid Diesel': 'Mild hybrid diesel',
    'Hybrid Diesel': 'Hybrid diesel',
}
SOURCE = ('Makes, models and engines from vehicle-makes-models (github.com/gor3a/vehicle-makes-models), '
          'built from autoevolution.com data. Petrol, diesel, electric and hybrid engines only.')
LICENCE = ('Open Database License (ODbL) v1.0. Attribution required; adapted versions offered under the ODbL. '
           'See LICENSE-DATA in the source repository.')


def tidy(text):
    return re.sub(r'\s+', ' ', text or '').strip()


def slug(name):
    plain = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', plain.lower()).strip('-')


def main(sqlite_path):
    db = sqlite3.connect('file:%s?mode=ro' % sqlite_path, uri=True)
    rows = db.execute('''select m.name, mo.name, e.label, e.fuel_type from engines e
        join generations g on g.id = e.generation_id join models mo on mo.id = g.model_id
        join makes m on m.id = mo.make_id''').fetchall()
    tree = {}
    for make, model, label, fuel in rows:
        if fuel not in FUEL or not tidy(label):
            continue
        tree.setdefault(tidy(make), {}).setdefault(tidy(model), set()).add((tidy(label), FUEL[fuel]))

    os.makedirs(OUT, exist_ok=True)
    for old in os.listdir(OUT):
        os.remove(os.path.join(OUT, old))
    built = datetime.date.today().isoformat()
    index = {'_source': SOURCE, '_licence': LICENCE, '_built': built, 'makes': []}
    for make in sorted(tree, key=str.lower):
        key = slug(make)
        models = []
        for model in sorted(tree[make], key=str.lower):
            variants = [{'name': n, 'fuel': f} for n, f in sorted(tree[make][model], key=lambda x: (x[0].lower(), x[1]))]
            models.append({'name': model, 'variants': variants})
        with open(os.path.join(OUT, key + '.json'), 'w', encoding='utf-8') as f:
            json.dump({'name': make, 'models': models}, f, ensure_ascii=False, indent=1)
            f.write('\n')
        index['makes'].append({
            'name': make,
            'slug': key,
            'models': len(models),
            'variants': sum(len(m['variants']) for m in models),
        })
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
        f.write('\n')
    total_models = sum(m['models'] for m in index['makes'])
    total_variants = sum(m['variants'] for m in index['makes'])
    print('makes', len(index['makes']), 'models', total_models, 'variants', total_variants)


if __name__ == '__main__':
    main(sys.argv[1])
