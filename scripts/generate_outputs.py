from __future__ import annotations

import json
import csv
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from birbal_engine import evaluate_profile, load_catalog  # noqa: E402


def main() -> None:
    catalog = load_catalog()
    profiles = json.loads((ROOT / "data" / "test_profiles.json").read_text(encoding="utf-8"))
    results = [evaluate_profile(profile, catalog) for profile in profiles]
    destination = ROOT / "outputs" / "test_results.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(results)} profile results to {destination}")

    summary_path = ROOT / "outputs" / "test_summary.csv"
    with summary_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["profile_id", "passes_public_rules", "fails_public_rule", "insufficient_public_data", "best_option"],
            lineterminator="\n",
        )
        writer.writeheader()
        for result in results:
            decisions = [item["decision"] for item in result["lenders"]]
            writer.writerow({
                "profile_id": result["profile_id"],
                "passes_public_rules": decisions.count("passes_public_rules"),
                "fails_public_rule": decisions.count("fails_public_rule"),
                "insufficient_public_data": decisions.count("insufficient_public_data"),
                "best_option": (result.get("best_option") or {}).get("lender_name", ""),
            })
    print(f"Wrote test summary to {summary_path}")


if __name__ == "__main__":
    main()
