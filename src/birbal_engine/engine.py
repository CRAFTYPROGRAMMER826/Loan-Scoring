from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CATALOG = ROOT / "data" / "lenders.json"


def load_catalog(path: Path | str = DEFAULT_CATALOG) -> list[dict[str, Any]]:
    with Path(path).open(encoding="utf-8") as handle:
        return json.load(handle)


def _monthly_payment_capacity(income: float, existing_emis: float, foir_pct: float) -> float:
    return max(0.0, income * foir_pct / 100.0 - existing_emis)


def _present_value_from_emi(emi: float, annual_rate_pct: float, months: int) -> float:
    if emi <= 0 or months <= 0:
        return 0.0
    monthly_rate = annual_rate_pct / 1200.0
    if monthly_rate == 0:
        return emi * months
    return emi * (1 - (1 + monthly_rate) ** (-months)) / monthly_rate


def _resolve_segment_rules(lender: dict[str, Any], employment_type: str) -> list[dict[str, Any]]:
    rules = list(lender.get("rules", []))
    rules.extend(lender.get("segment_rules", {}).get(employment_type, []))
    return rules


def _check_rule(profile: dict[str, Any], rule: dict[str, Any]) -> tuple[bool, str]:
    field = rule["field"]
    actual = profile.get(field)
    expected = rule.get("value")
    operator = rule["operator"]
    label = rule.get("label", field.replace("_", " "))

    if actual is None:
        return False, f"Missing applicant value: {label}."
    if operator == ">=":
        ok = float(actual) >= float(expected)
        return ok, f"{label} must be at least {expected}; provided {actual}."
    if operator == "<=":
        ok = float(actual) <= float(expected)
        return ok, f"{label} must not exceed {expected}; provided {actual}."
    if operator == "=":
        ok = actual == expected
        return ok, f"{label} must be {expected}; provided {actual}."
    if operator == "in":
        ok = actual in expected
        return ok, f"{label} must be one of {expected}; provided {actual}."
    raise ValueError(f"Unsupported operator: {operator}")


def _estimate_public_cap(profile: dict[str, Any], lender: dict[str, Any]) -> dict[str, Any]:
    product = lender.get("product", {})
    caps: list[tuple[str, float, str]] = []
    published_max = product.get("max_amount_inr")
    if published_max:
        caps.append((
            "advertised product maximum",
            float(published_max),
            f"Published product ceiling = ₹{float(published_max):,.0f}",
        ))

    affordability = lender.get("affordability", {})
    income = float(profile.get("monthly_income_inr") or 0)
    existing_emis = float(profile.get("existing_monthly_emis_inr") or 0)
    rate = product.get("min_rate_pct")
    requested_months = profile.get("requested_tenure_months")
    product_max_months = product.get("max_tenure_months")
    months = min(requested_months, product_max_months) if requested_months and product_max_months else product_max_months

    if affordability.get("foir_cap_pct") is not None and rate is not None and months:
        foir_pct = float(affordability["foir_cap_pct"])
        emi = _monthly_payment_capacity(income, existing_emis, foir_pct)
        caps.append((
            "published FOIR affordability",
            _present_value_from_emi(emi, rate, months),
            f"New EMI room = {foir_pct:g}% of ₹{income:,.0f} income − ₹{existing_emis:,.0f} existing EMIs = ₹{emi:,.0f}/month; converted to principal at {float(rate):g}% for {int(months)} months",
        ))

    if affordability.get("emi_nmi_cap_pct") is not None and rate is not None and months:
        emi_nmi_pct = float(affordability["emi_nmi_cap_pct"])
        emi = max(0.0, income * emi_nmi_pct / 100.0)
        caps.append((
            "published proposed EMI/NMI ratio",
            _present_value_from_emi(emi, rate, months),
            f"Proposed new-loan EMI ceiling = {emi_nmi_pct:g}% of ₹{income:,.0f} NMI = ₹{emi:,.0f}/month; converted to principal at {float(rate):g}% for {int(months)} months. Existing EMIs are not subtracted because the cited rule is EMI/NMI, not a published FOIR rule.",
        ))

    residual_pct = affordability.get("min_residual_income_pct")
    residual_floor = affordability.get("min_residual_income_inr")
    if residual_pct is not None and residual_floor is not None and rate is not None and months:
        required_residual = max(income * float(residual_pct) / 100.0, float(residual_floor))
        emi = max(0.0, income - existing_emis - required_residual)
        caps.append((
            "published minimum net-take-home rule",
            _present_value_from_emi(emi, rate, months),
            f"New EMI room = ₹{income:,.0f} income − ₹{existing_emis:,.0f} existing EMIs − ₹{required_residual:,.0f} required residual income = ₹{emi:,.0f}/month; converted to principal at {float(rate):g}% for {int(months)} months",
        ))

    if affordability.get("salary_multiple") is not None and income:
        multiple = float(affordability["salary_multiple"])
        caps.append((
            "published salary multiple",
            income * multiple,
            f"Salary-multiple cap = ₹{income:,.0f} NMI × {multiple:g} = ₹{income * multiple:,.0f}",
        ))

    if len(caps) <= 1:
        return {
            "amount_inr": None,
            "basis": "not publicly determinable",
            "advertised_product_max_inr": published_max,
            "calculation": None,
            "components": [
                {"basis": basis, "amount_inr": int(value), "calculation": calculation}
                for basis, value, calculation in caps
            ],
        }

    basis, amount, calculation = min(caps, key=lambda item: item[1])
    return {
        "amount_inr": int(math.floor(amount / 1000.0) * 1000),
        "basis": basis,
        "advertised_product_max_inr": published_max,
        "calculation": calculation,
        "components": [
            {"basis": cap_basis, "amount_inr": int(cap_amount), "calculation": cap_calculation}
            for cap_basis, cap_amount, cap_calculation in caps
        ],
    }


def evaluate_lender(profile: dict[str, Any], lender: dict[str, Any]) -> dict[str, Any]:
    profile = dict(profile)
    if "relationship_lender_ids" in profile:
        profile["salary_account_with_lender"] = lender["lender_id"] in set(profile.get("relationship_lender_ids") or [])
    if profile.get("age_years") is not None and profile.get("requested_tenure_months") is not None:
        profile["age_at_maturity_years"] = float(profile["age_years"]) + float(profile["requested_tenure_months"]) / 12.0
    employment_type = profile.get("employment_type")
    supported = lender.get("supported_employment_types", [])
    hard_failures: list[str] = []
    missing_inputs: list[str] = []

    if supported and employment_type not in supported:
        hard_failures.append(
            f"Employment type {employment_type!r} is outside the publicly documented segment {supported}."
        )

    for rule in _resolve_segment_rules(lender, employment_type):
        if rule.get("strength") != "hard":
            continue
        passed, message = _check_rule(profile, rule)
        if not passed:
            if message.startswith("Missing applicant value"):
                missing_inputs.append(message)
            else:
                hard_failures.append(message)

    product = lender.get("product", {})
    requested_amount = profile.get("requested_amount_inr")
    requested_tenure = profile.get("requested_tenure_months")
    public_maximum = _estimate_public_cap(profile, lender)
    applicant_cap = public_maximum.get("amount_inr")
    advertised_cap = public_maximum.get("advertised_product_max_inr")
    applicable_cap = applicant_cap if applicant_cap is not None else advertised_cap

    if requested_amount is not None and applicable_cap is not None and float(requested_amount) > float(applicable_cap):
        hard_failures.append(
            f"Requested amount must not exceed the calculated public-rule maximum of {int(applicable_cap)}; provided {int(requested_amount)}."
        )
    minimum_tenure = product.get("min_tenure_months")
    maximum_tenure = product.get("max_tenure_months")
    if requested_tenure is not None and minimum_tenure is not None and int(requested_tenure) < int(minimum_tenure):
        hard_failures.append(
            f"Requested tenure must be at least {minimum_tenure} months; provided {requested_tenure}."
        )
    if requested_tenure is not None and maximum_tenure is not None and int(requested_tenure) > int(maximum_tenure):
        hard_failures.append(
            f"Requested tenure must not exceed {maximum_tenure} months; provided {requested_tenure}."
        )

    if hard_failures:
        decision = "fails_public_rule"
    elif lender.get("data_status") == "insufficient" or missing_inputs:
        decision = "insufficient_public_data"
    else:
        decision = "passes_public_rules"

    return {
        "lender_id": lender["lender_id"],
        "lender_name": lender["lender_name"],
        "product_name": lender["product_name"],
        "decision": decision,
        "failure_reasons": hard_failures,
        "missing_inputs": missing_inputs,
        "public_maximum": public_maximum,
        "advertised_rate_pct": {
            "minimum": product.get("min_rate_pct"),
            "maximum": product.get("max_rate_pct"),
            "label": "advertised, not personalised",
        },
        "tenure_months": {
            "minimum": product.get("min_tenure_months"),
            "maximum": product.get("max_tenure_months"),
        },
        "advisories": lender.get("advisories", []),
        "evidence": lender.get("evidence", []),
        "data_status": lender.get("data_status"),
    }


def rank_results(results: list[dict[str, Any]], requested_amount_inr: float) -> list[dict[str, Any]]:
    eligible = [item for item in results if item["decision"] == "passes_public_rules"]

    def key(item: dict[str, Any]) -> tuple[int, int, float, str]:
        public_max = (item.get("public_maximum") or {}).get("amount_inr")
        advertised_max = (item.get("public_maximum") or {}).get("advertised_product_max_inr")
        capacity = public_max if public_max is not None else advertised_max
        covers = capacity is not None and capacity >= requested_amount_inr
        evidence_order = {"verified": 0, "partial": 1, "conflict": 2, "insufficient": 3}
        evidence = evidence_order.get(item.get("data_status"), 4)
        rate = item["advertised_rate_pct"].get("minimum")
        return (0 if covers else 1, evidence, float(rate) if rate is not None else 999.0, item["lender_name"])

    return sorted(eligible, key=key)


def evaluate_profile(profile: dict[str, Any], catalog: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    catalog = catalog or load_catalog()
    results = [evaluate_lender(profile, lender) for lender in catalog]
    ranked = rank_results(results, float(profile.get("requested_amount_inr") or 0))
    return {
        "profile_id": profile.get("profile_id"),
        "disclaimer": (
            "This is a public-rule screening result, not an approval prediction. "
            "Final approval, amount and pricing depend on the lender's internal assessment."
        ),
        "best_option": ranked[0] if ranked else None,
        "lenders": results,
    }
