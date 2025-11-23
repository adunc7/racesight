#!/usr/bin/env python3
"""
extract_laps.py

Read a JSON file (either a JSON array, a single JSON object, or JSON Lines) and
write a new JSON file containing only records whose `lap` field is in the
requested set (default: 2,3,4).

Usage:
  python extract_laps.py input.json output.json [--laps 2,3,4]

"""
import json
import sys
from pathlib import Path


def load_json(path: Path):
    text = path.read_text(encoding='utf-8')
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return [data]
        if isinstance(data, list):
            return data
    except json.JSONDecodeError:
        # fallthrough to try JSON Lines
        pass

    items = []
    for ln in text.splitlines():
        ln = ln.strip()
        if not ln:
            continue
        try:
            items.append(json.loads(ln))
        except json.JSONDecodeError:
            # skip malformed lines
            continue
    return items


def filter_laps(items, allowed_laps):
    allowed = set(allowed_laps)
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        lap = it.get('lap')
        try:
            if lap in allowed:
                out.append(it)
        except Exception:
            continue
    return out


def main(argv):
    if len(argv) < 3:
        print("Usage: extract_laps.py <input.json> <output.json> [--laps 2,3,4]")
        return 2

    in_path = Path(argv[1])
    out_path = Path(argv[2])

    laps = (2, 3, 4)
    if '--laps' in argv:
        idx = argv.index('--laps')
        if idx + 1 < len(argv):
            laps = tuple(int(x) for x in argv[idx + 1].split(',') if x)

    if not in_path.exists():
        print(f"Input file does not exist: {in_path}")
        return 3

    items = load_json(in_path)
    filtered = filter_laps(items, laps)

    out_path.write_text(json.dumps(filtered, indent=2), encoding='utf-8')
    print(f"Wrote {len(filtered)} records to {out_path}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
