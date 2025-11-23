import pandas as pd
import json
from pathlib import Path
import sys

# --- 🧠 Configure folders here ---
INPUT_DIR = Path(r"Barber_Data_XLS")   # 👈 change this
OUTPUT_DIR = Path(r"Barber_Data_JSON_UPDATED")  # or use INPUT_DIR if you want same place
OUTPUT_DIR.mkdir(exist_ok=True, parents=True)

def load_file(path: Path):
    """Reads Excel or CSV/TXT file into a pandas DataFrame."""
    suf = path.suffix.lower()
    try:
        if suf in ('.xls', '.xlsx'):
            return pd.read_excel(path)
        elif suf in ('.csv', '.txt'):
            # Try to auto-detect delimiter
            try:
                return pd.read_csv(path, sep=None, engine='python', encoding='utf-8')
            except Exception:
                return pd.read_csv(path, sep=',', encoding='utf-8')
        else:
            print(f"⚠️ Unsupported file type: {path.name}")
            return None
    except Exception as ex:
        print(f"❌ Error reading {path.name}: {ex}")
        return None
    
def _clean_value(v):
    """Recursively convert NaN/NaT/numpy scalars to JSON-friendly Python values."""
    # detect missing
    if pd.isna(v):
        return None
    # dict/list recursion
    if isinstance(v, dict):
        return {k: _clean_value(val) for k, val in v.items()}
    if isinstance(v, list):
        return [_clean_value(i) for i in v]
    # numpy / pandas scalar -> python native
    if hasattr(v, "item"):
        try:
            return v.item()
        except Exception:
            pass
    return v    

def convert_to_json(df: pd.DataFrame, out_path: Path):
    """Converts a DataFrame to JSON and writes it to a file."""
    # 1) convert empty strings to None (so they become null in JSON)
    df = df.replace(r'^\s*$', None, regex=True)

    # 2) ensure missing values (NaN/NaT) become Python None
    df = df.astype(object).where(pd.notnull(df), None)

    # 3) to handle any numpy/pandas scalars inside object cells, convert records and clean recursively
    records = df.to_dict(orient='records')
    cleaned = [_clean_value(r) for r in records]

    try:
        with out_path.open('w', encoding='utf-8') as f:
            json.dump(cleaned, f, ensure_ascii=False, indent=2, allow_nan=False)
        print(f"✅ {out_path.name} written ({len(cleaned)} records)")
    except ValueError as ex:
        print(f"❌ JSON serialization error for {out_path.name}: {ex}")

def main():
    supported_exts = {'.csv', '.txt', '.xls', '.xlsx'}
    print(f"Converting all supported files in: {INPUT_DIR}\n")

    for file in INPUT_DIR.iterdir():
        if file.suffix.lower() in supported_exts:
            out = OUTPUT_DIR / file.with_suffix('.json').name
            df = load_file(file)
            if df is not None:
                convert_to_json(df, out)
    
    print("\n🎉 All conversions complete!")

if __name__ == '__main__':
    main()
