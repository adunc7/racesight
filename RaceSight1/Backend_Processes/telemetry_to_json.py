#Takes the telemetry CSV/Excel file and splits it into per-vehicle Excel files, 
# optionally converting to JSON.

import json
import sys
from pathlib import Path
from typing import List, Optional

try:
    import pandas as pd
except Exception as e:
    print("pandas is required. Install with: python -m pip install pandas openpyxl", file=sys.stderr)
    raise

# ----------------- Configuration (edit as needed) -----------------
# By default this uses workspace-relative paths (script is in Backend_Processes)
WORKSPACE_ROOT = Path(__file__).resolve().parents[1]

# default input file (workspace-relative)
DEFAULT_INPUT = WORKSPACE_ROOT / "Barber_Data_XLS_TELEM" / "R2_barber_telemetry_data.csv"

# where per-vehicle Excel files will be written by default
DEFAULT_EXCEL_OUT = WORKSPACE_ROOT / "R2_barber_telemetry_output_by_vehicle"

# where JSON files will be written by default (inside excel out folder)
DEFAULT_JSON_OUT = DEFAULT_EXCEL_OUT / "json"

# set to True to convert produced Excel files to JSON as well
DEFAULT_TO_JSON = True
# -----------------------------------------------------------------

def find_file_in_workspace(name: str, root: Path) -> Optional[Path]:
    """Search workspace for filename (first match)"""
    matches = list(root.rglob(name))
    return matches[0] if matches else None

def load_input(path: Path) -> pd.DataFrame:
    suf = path.suffix.lower()
    if suf in (".xls", ".xlsx"):
        return pd.read_excel(path, engine="openpyxl")
    # treat everything else as CSV
    return pd.read_csv(path)

def write_excels(df: pd.DataFrame, out_dir: Path) -> List[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written: List[Path] = []
    if "vehicle_number" not in df.columns:
        raise KeyError("Input does not contain a 'vehicle_number' column.")
    for vehicle_number, group in df.groupby("vehicle_number"):
        filename = out_dir / f"vehicle_{vehicle_number}.xlsx"
        group.to_excel(filename, index=False, engine="openpyxl")
        written.append(filename)
        print(f"Saved: {filename}")
    return written

def _clean_value(v):
    """Recursively convert NaN/NaT/numpy scalars to JSON-friendly Python values (NaN -> None)."""
    if pd.isna(v):
        return None
    if isinstance(v, dict):
        return {k: _clean_value(val) for k, val in v.items()}
    if isinstance(v, (list, tuple)):
        return [_clean_value(i) for i in v]
    if hasattr(v, "item"):
        try:
            return v.item()
        except Exception:
            pass
    return v

def excel_to_json(xlsx_path: Path, json_path: Path):
    df = pd.read_excel(xlsx_path, engine="openpyxl")
    # convert blank/whitespace-only strings to None, and pandas NaN/NaT to None
    df = df.replace(r'^\s*$', None, regex=True)
    df = df.astype(object).where(pd.notnull(df), None)
    records = df.to_dict(orient="records")
    cleaned = [_clean_value(r) for r in records]
    json_path.parent.mkdir(parents=True, exist_ok=True)
    with json_path.open("w", encoding="utf-8") as f:
        json.dump(cleaned, f, ensure_ascii=False, indent=2, allow_nan=False)
    print(f"Wrote JSON: {json_path} ({len(cleaned)} records)")

def process(input_path: Path,
            excel_out: Path,
            json_out: Path,
            to_json: bool):
    input_path = input_path.expanduser()
    if not input_path.exists():
        # try searching workspace for same filename
        candidate = find_file_in_workspace(input_path.name, WORKSPACE_ROOT)
        if candidate:
            print(f"Input not found at {input_path}. Found by search: {candidate}")
            input_path = candidate
        else:
            raise FileNotFoundError(f"Input file not found: {input_path}\nSearched workspace: {WORKSPACE_ROOT}")

    input_path = input_path.resolve()
    excel_out = excel_out.expanduser().resolve()
    json_out = json_out.expanduser().resolve()

    print(f"Loading input: {input_path}")
    df = load_input(input_path)

    print(f"Writing per-vehicle Excel files to: {excel_out}")
    excel_files = write_excels(df, excel_out)

    if to_json:
        print(f"Converting Excel files to JSON in: {json_out}")
        for xlsx in excel_files:
            target_json = json_out / xlsx.with_suffix(".json").name
            try:
                excel_to_json(xlsx, target_json)
            except Exception as ex:
                print(f"Failed to convert {xlsx} -> {target_json}: {ex}", file=sys.stderr)

def main():
    # allow quick CLI overrides but keep simple defaults
    import argparse
    p = argparse.ArgumentParser(description="Split telemetry file by vehicle_number and optionally convert to JSON.")
    p.add_argument("--input", "-i", default=str(DEFAULT_INPUT), help="Input telemetry file (CSV or Excel)")
    p.add_argument("--excel-out", "-e", default=str(DEFAULT_EXCEL_OUT), help="Directory for per-vehicle Excel files")
    p.add_argument("--json-out", "-j", default=str(DEFAULT_JSON_OUT), help="Directory for JSON output")
    p.add_argument("--no-json", action="store_true", help="Skip converting Excel files to JSON")
    args = p.parse_args()

    try:
        process(Path(args.input), Path(args.excel_out), Path(args.json_out), to_json=not args.no_json)
    except Exception as ex:
        print(f"Error: {ex}", file=sys.stderr)
        sys.exit(1)
    print("Done.")

if __name__ == "__main__":
    main()