from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import streamlit as st


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from birbal_engine import evaluate_profile, load_catalog, rank_results  # noqa: E402


st.set_page_config(page_title="Birbal public-rule screener", page_icon="🧭", layout="wide")

st.title("Birbal — public-rule personal-loan screener")
st.caption(
    "A transparent research prototype. It checks published rules; it does not predict or guarantee approval."
)

with st.sidebar:
    st.header("Applicant profile")
    employment_type = st.selectbox("Employment type", ["salaried", "self_employed"])
    age_years = st.number_input("Age", 18, 80, 30)
    monthly_income_inr = st.number_input("Net monthly income (₹)", 0, 5_000_000, 80_000, step=5_000)
    existing_monthly_emis_inr = st.number_input("Existing monthly EMIs (₹)", 0, 5_000_000, 10_000, step=1_000)
    cibil_known = st.checkbox("I know my CIBIL score")
    cibil_score = st.number_input(
        "CIBIL score",
        300,
        900,
        760,
        disabled=not cibil_known,
        help="Optional. If omitted, lenders with a published numeric cut-off are marked as having insufficient applicant data—not rejected.",
    )
    total_work_months = st.number_input("Total work experience (months)", 0, 600, 60)
    current_job_months = st.number_input("Current job tenure (months)", 0, 600, 24)
    business_vintage_months = st.number_input("Business vintage (months)", 0, 600, 36)
    relationship_lender_ids = st.multiselect(
        "Existing lender relationships",
        options=["L001", "L010"],
        format_func=lambda value: {
            "L001": "SBI salary account",
            "L010": "RBL savings or corporate salary account",
        }[value],
        help="Select only lenders where you already hold the relationship required by the captured product.",
    )
    resident_indian = st.checkbox("Resident Indian", value=True)
    requested_amount_inr = st.number_input("Requested amount (₹)", 10_000, 100_000_000, 500_000, step=50_000)
    requested_tenure_months = st.number_input("Requested tenure (months)", 6, 120, 36, step=6)

profile = {
    "profile_id": "interactive",
    "employment_type": employment_type,
    "age_years": age_years,
    "monthly_income_inr": monthly_income_inr,
    "existing_monthly_emis_inr": existing_monthly_emis_inr,
    "cibil_score": cibil_score if cibil_known else None,
    "total_work_months": total_work_months,
    "current_job_months": current_job_months,
    "business_vintage_months": business_vintage_months,
    "relationship_lender_ids": relationship_lender_ids,
    "resident_indian": resident_indian,
    "requested_amount_inr": requested_amount_inr,
    "requested_tenure_months": requested_tenure_months,
}

catalog = load_catalog()
result = evaluate_profile(profile, catalog)
ranked = rank_results(result["lenders"], requested_amount_inr)

counts = pd.Series([item["decision"] for item in result["lenders"]]).value_counts()
c1, c2, c3 = st.columns(3)
c1.metric("Pass disclosed rules", int(counts.get("passes_public_rules", 0)))
c2.metric("Fail disclosed rule", int(counts.get("fails_public_rule", 0)))
c3.metric("Insufficient public data", int(counts.get("insufficient_public_data", 0)))

if result["best_option"]:
    best = result["best_option"]
    st.subheader("Indicative best match")
    st.success(
        f"{best['lender_name']} — ranked using public-rule pass, requested-amount coverage and advertised starting rate. "
        "This is not an approval or personalised-rate prediction."
    )

rows = []
for item in ranked + [x for x in result["lenders"] if x not in ranked]:
    maximum = item.get("public_maximum") or {}
    rate = item["advertised_rate_pct"]
    tenure = item["tenure_months"]
    rows.append(
        {
            "Lender": item["lender_name"],
            "Decision": item["decision"],
            "Public-rule maximum": maximum.get("amount_inr") or "Not determinable",
            "Advertised product maximum": maximum.get("advertised_product_max_inr") or "Unknown",
            "Advertised rate": (
                f"{rate['minimum']}%–{rate['maximum']}%"
                if rate.get("minimum") is not None and rate.get("maximum") is not None
                else f"From {rate['minimum']}%" if rate.get("minimum") is not None
                else f"Up to {rate['maximum']}%" if rate.get("maximum") is not None else "Unknown"
            ),
            "Tenure": (
                f"{tenure['minimum']}–{tenure['maximum']} months"
                if tenure.get("minimum") is not None and tenure.get("maximum") is not None
                else f"Up to {tenure['maximum']} months" if tenure.get("maximum") is not None
                else f"From {tenure['minimum']} months" if tenure.get("minimum") is not None else "Unknown"
            ),
            "Why": "; ".join(item["failure_reasons"] or item["missing_inputs"] or item["advisories"][:1]),
        }
    )

st.subheader("Lender comparison")
st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)

with st.expander("Evidence and assumptions"):
    for item in result["lenders"]:
        st.markdown(f"**{item['lender_name']}** — `{item['data_status']}`")
        for evidence in item["evidence"]:
            st.markdown(f"- [{evidence['label']}]({evidence['url']}) — accessed {evidence['accessed_date']}")
        for advisory in item["advisories"]:
            st.markdown(f"- {advisory}")

st.warning(result["disclaimer"])
