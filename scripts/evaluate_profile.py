from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from birbal_engine.engine import evaluate_profile  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Screen one applicant against the captured public lender rules."
    )
    parser.add_argument("profile", type=Path, help="Path to a JSON applicant profile")
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional JSON output path; otherwise the result is printed",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    profile = json.loads(args.profile.read_text(encoding="utf-8"))
    result = evaluate_profile(profile)
    rendered = json.dumps(result, indent=2, ensure_ascii=False)

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
        print(f"Wrote screening result to {args.output}")
    else:
        print(rendered)


if __name__ == "__main__":
    main()
