from __future__ import annotations

import csv
import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def find_rule(lender: dict, field: str) -> str:
    values = []
    for rule in lender.get("rules", []):
        if rule["field"] == field and rule.get("strength") == "hard":
            values.append(f"{rule['operator']}{rule['value']}")
    for segment, rules in lender.get("segment_rules", {}).items():
        for rule in rules:
            if rule["field"] == field and rule.get("strength") == "hard":
                values.append(f"{segment}:{rule['operator']}{rule['value']}")
    return "; ".join(values)


def main() -> None:
    catalog_path = ROOT / "data" / "lenders.json"
    lenders = json.loads(catalog_path.read_text(encoding="utf-8"))
    web_catalog_path = ROOT / "web" / "dist" / "assets" / "lenders.json"
    web_catalog_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(catalog_path, web_catalog_path)
    print(f"Synced lender catalogue to {web_catalog_path}")
    columns = [
        "lender_id", "lender_name", "product_name", "data_status", "employment_types",
        "age_rule", "maturity_age_rule", "income_rule", "cibil_rule", "work_rule",
        "business_vintage_rule", "foir_cap_pct", "emi_nmi_cap_pct", "salary_multiple", "min_residual_income_pct",
        "min_residual_income_inr", "advertised_max_amount_inr",
        "advertised_min_rate_pct", "advertised_max_rate_pct", "minimum_tenure_months",
        "maximum_tenure_months", "primary_source_url", "accessed_date", "notes"
    ]
    path = ROOT / "data" / "lender_rule_matrix.csv"
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        for lender in lenders:
            product = lender.get("product", {})
            affordability = lender.get("affordability", {})
            evidence = lender.get("evidence", [])
            writer.writerow({
                "lender_id": lender["lender_id"],
                "lender_name": lender["lender_name"],
                "product_name": lender["product_name"],
                "data_status": lender["data_status"],
                "employment_types": "|".join(lender.get("supported_employment_types", [])),
                "age_rule": find_rule(lender, "age_years"),
                "maturity_age_rule": find_rule(lender, "age_at_maturity_years"),
                "income_rule": find_rule(lender, "monthly_income_inr"),
                "cibil_rule": find_rule(lender, "cibil_score"),
                "work_rule": "; ".join(filter(None, [find_rule(lender, "total_work_months"), find_rule(lender, "current_job_months")])),
                "business_vintage_rule": find_rule(lender, "business_vintage_months"),
                "foir_cap_pct": affordability.get("foir_cap_pct"),
                "emi_nmi_cap_pct": affordability.get("emi_nmi_cap_pct"),
                "salary_multiple": affordability.get("salary_multiple"),
                "min_residual_income_pct": affordability.get("min_residual_income_pct"),
                "min_residual_income_inr": affordability.get("min_residual_income_inr"),
                "advertised_max_amount_inr": product.get("max_amount_inr"),
                "advertised_min_rate_pct": product.get("min_rate_pct"),
                "advertised_max_rate_pct": product.get("max_rate_pct"),
                "minimum_tenure_months": product.get("min_tenure_months"),
                "maximum_tenure_months": product.get("max_tenure_months"),
                "primary_source_url": evidence[0]["url"] if evidence else "",
                "accessed_date": evidence[0]["accessed_date"] if evidence else "",
                "notes": " | ".join(lender.get("advisories", [])),
            })
    print(f"Wrote {len(lenders)} lender rows to {path}")

    evidence_path = ROOT / "data" / "rule_evidence.csv"
    evidence_columns = [
        "rule_id", "lender_id", "lender_name", "product_name", "segment", "field",
        "operator", "value", "strength", "source_url", "accessed_date", "data_status", "notes"
    ]
    rule_number = 1
    with evidence_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=evidence_columns, lineterminator="\n")
        writer.writeheader()
        for lender in lenders:
            evidence = lender.get("evidence", [])
            source_url = evidence[0]["url"] if evidence else ""
            accessed_date = evidence[0]["accessed_date"] if evidence else ""
            scoped_rules = [("all", rule) for rule in lender.get("rules", [])]
            for segment, rules in lender.get("segment_rules", {}).items():
                scoped_rules.extend((segment, rule) for rule in rules)
            for segment, rule in scoped_rules:
                writer.writerow({
                    "rule_id": f"CR-{rule_number:03d}",
                    "lender_id": lender["lender_id"],
                    "lender_name": lender["lender_name"],
                    "product_name": lender["product_name"],
                    "segment": segment,
                    "field": rule["field"],
                    "operator": rule["operator"],
                    "value": rule["value"],
                    "strength": rule["strength"],
                    "source_url": source_url,
                    "accessed_date": accessed_date,
                    "data_status": lender["data_status"],
                    "notes": " | ".join(lender.get("advisories", [])),
                })
                rule_number += 1
    print(f"Wrote {rule_number - 1} rule rows to {evidence_path}")


if __name__ == "__main__":
    main()
