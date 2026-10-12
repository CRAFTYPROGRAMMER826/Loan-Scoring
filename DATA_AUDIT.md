# Data audit

## Submission status

**Complete as a public-rule research prototype.**

The repository is reproducible, contains 20 traceable lender records, 86 sourced hard-rule rows, 10 edge-case profiles and generated outputs. It is intentionally **not** a bank-approval model because lender scorecards and customer approval data are private.

## Cleaning decisions

- Kept personal-loan products only.
- Preferred current official lender pages and documents.
- Removed the historical June 2020 IDFC partner-training PDF from current rules.
- Never converted words such as `preferred`, `ideal`, `may` or `typical` into rejection cut-offs.
- Kept conflicting official statements visible instead of choosing a convenient value.
- Separated product maximum from applicant-specific maximum.
- Added requested amount and tenure as decision gates when public limits exist.
- Scoped existing-account requirements to the correct lender.
- Used the stricter published threshold when a lower threshold depends on an employer category, city or relationship that the form does not collect.
- Left unverifiable values null; no unsupported estimate is encoded as a hard rule.

## Calculator treatment

- Eligibility calculators were reviewed as supporting evidence.
- EMI calculators were used only for repayment mathematics.
- OTP/login-dependent results were excluded.
- No calculator output was treated as approval.
- See `data/calculator_observations.csv` for the audit trail.

## Known public-data limitations

| Lender | Limitation | Conservative treatment |
|---|---|---|
| HDFC Bank | Complete current national pricing was not captured. | Eligibility can be screened; rate remains unknown. |
| Kotak Mahindra Bank | Income evidence is city/relationship specific. | Dataset is marked `partial`; scope is disclosed. |
| SBI / Axis Bank | Lower income or service thresholds depend on employer/customer relationship. | Stricter published thresholds are used when that detail is not collected. |
| SBI | The page publishes proposed EMI/NMI up to 65%, not a FOIR definition. | Stored separately as `emi_nmi_cap_pct`; existing EMIs are not subtracted under this ratio, and the UI shows the derived calculation. |
| IndusInd Bank | One page states 12–60 months for the broader product and 12–48 months for the online instant route. | The row is explicitly scoped to the Online Instant Personal Loan: ₹30,000–₹5 lakh and 12–48 months. |
| IDFC FIRST Bank | Historical pages contain score conflicts. | Current higher-limit product used; 730 remains advisory. |
| PNB | Several personal-loan schemes have different rules. | Only scheme-scoped rules are applied; row is `partial`. |
| Aditya Birla Finance | Official score and age statements conflict. | Conflicting values stay advisory; no score rejection. |
| L&T Finance | Official pages disagree on score, rate and experience wording. | Stable age/income rules only; row is `conflict`. |
| HDB Financial Services | Income varies by city and official pages show different advertised caps. | Higher ₹20,000 income threshold and lower ₹20 lakh cap retained. |
| Navi | No stable official eligibility cut-off was found. | Always `insufficient_public_data`; no invented rule. |

## Verification gates

- `python3 -m unittest discover -s tests -v` — 12 behavioural tests, including explicit SBI EMI/NMI and IndusInd product-scope regressions.
- `python3 scripts/build_matrix.py` — rebuilds 20 lender rows and 86 rule rows.
- `python3 scripts/generate_outputs.py` — rebuilds all 10 profile outputs and summary CSV.
- `node --check web/dist/app.js` — validates deployed frontend JavaScript syntax.

## Honest boundary

Passing means **no captured hard public rule failed**. It does not mean the lender will approve the application or offer the advertised minimum rate.
