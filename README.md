# Birbal Lens

An explainable personal-loan screening prototype for Indian borrowers.

Repository: [CRAFTYPROGRAMMER826/Loan-Scoring](https://github.com/CRAFTYPROGRAMMER826/Loan-Scoring)

It answers:

> “Based on public rules, which lenders are worth investigating—and why?”

It does **not** claim bank approval. Final underwriting still depends on private lender policies, complete bureau data, fraud checks and document verification.


## What the model returns

- A result for each of 20 researched lenders.
- The exact public rule that passed, failed or could not be tested.
- Applicant value versus lender requirement.
- Official source URL and access date.
- Applicant-specific maximum when public affordability rules allow it.
- Advertised product cap when a personal maximum cannot be calculated.
- Advertised rate range and available tenure.
- A transparent best-fit shortlist.

## Decision labels

| Label | Meaning |
|---|---|
| `passes_public_rules` | No captured hard public rule failed. Approval is still unknown. |
| `fails_public_rule` | At least one published requirement, amount limit or tenure limit failed. |
| `insufficient_public_data` | A required applicant value or stable lender rule is unavailable. |

## How the screening works

1. Read the applicant profile.
2. Select rules for that employment type.
3. Check age, income, work history, credit score and lender relationship where published.
4. Check the requested amount and tenure against public product limits.
5. Calculate an applicant maximum only when FOIR, salary multiple or net-take-home rules are public.
6. Return the comparison, reason and evidence link for every lender.

There is no trained ML model because no labelled approval dataset was available.

## How “best fit” is chosen

The ranking is deterministic—not a hidden score.

1. Remove lenders that fail a captured hard public rule.
2. Prefer lenders whose public maximum covers the requested amount.
3. Prefer stronger evidence: `verified` → `partial` → `conflict` → `insufficient`.
4. Use the lower advertised starting rate as the final tie-breaker.
5. Use lender name only to make equal results stable and reproducible.

## Affordability example

Assume:

- Net monthly income: ₹80,000
- Existing EMIs: ₹10,000
- Published FOIR cap: 65%
- Requested tenure: 36 months
- Published starting rate: 10% p.a.

Calculation:

```text
Maximum total EMI = ₹80,000 × 65% = ₹52,000
Room for new EMI  = ₹52,000 − ₹10,000 = ₹42,000
Indicative maximum principal at 10% for 36 months ≈ ₹13.01 lakh
```

The result is an estimate from public rules—not a sanction amount.

## Interest-cost example

For ₹5 lakh over 36 months at an advertised 10% starting rate:

```text
Estimated EMI           ≈ ₹16,134/month
Estimated total interest ≈ ₹80,809
```

Processing fees, insurance, tax, floating-rate changes and personalised pricing are excluded.

## Why the rate is called “advertised”

The assessment asks for an expected rate, but lenders do not publish a reliable person-specific rate before underwriting.

- The model reports the official advertised starting rate or range.
- It never presents that value as a guaranteed offer.
- Missing rates remain `null`/unknown.

## Lender universe

The selected 20 are a documented comparison universe—not a claim of exact market-share ranking.

Selection factors:

- Regulated Indian bank or NBFC.
- Active personal-loan product.
- National or meaningful retail lending presence.
- Mix of public-sector banks, private banks, NBFCs and digital lenders.
- Sufficient public material to research or an important absence worth documenting.

| Group | Lenders |
|---|---|
| Public-sector banks | SBI, Bank of Baroda, Punjab National Bank, Canara Bank |
| Private banks | HDFC Bank, ICICI Bank, Axis Bank, Kotak Mahindra Bank, IDFC FIRST Bank, IndusInd Bank, YES BANK, Federal Bank, RBL Bank |
| NBFCs | Bajaj Finance, Tata Capital, Aditya Birla Finance, L&T Finance, SMFG India Credit, HDB Financial Services |
| Digital-first | Navi |

## Evidence policy

Preferred source order:

1. Official product or eligibility page.
2. Official rate sheet, schedule of charges, KFS/MITC or product document.
3. Official eligibility calculator.
4. Official FAQ or lender-authored explainer.
5. Third-party pages for discovery only—not final hard-rule evidence.

Research rules:

- Every captured rule has a source URL and access date.
- Sources were read on 12 October 2026.
- `ideal`, `preferred`, `may` and `typical` are advisory—not rejection rules.
- Conflicting official statements remain visible.
- OTP/login-dependent calculator results are excluded.
- EMI calculators never become eligibility calculators.
- No unsupported estimate is stored as a hard rule.

See `data/calculator_observations.csv` and `DATA_AUDIT.md` for the research trail.

## Input datapoints

| Variable | Example | Meaning | Source |
|---|---:|---|---|
| `employment_type` | `salaried` | Salaried or self-employed rule segment | Applicant |
| `age_years` | `30` | Completed age today | Applicant / DOB document |
| `monthly_income_inr` | `80000` | Regular net monthly income | Salary slip / bank statement |
| `existing_monthly_emis_inr` | `10000` | Current recurring debt payments | Bureau / bank statement |
| `cibil_score` | `780` or `null` | Optional bureau score | Credit bureau report |
| `total_work_months` | `60` | Total salaried experience | Employment documents |
| `current_job_months` | `24` | Time with current employer | Employment documents |
| `business_vintage_months` | `84` | Current business operating history | ITR / GST / registration |
| `relationship_lender_ids` | `["L001"]` | Existing relationships required by scoped products | Applicant / bank statement |
| `resident_indian` | `true` | Residency requirement | KYC documents |
| `requested_amount_inr` | `500000` | Loan amount requested | Applicant |
| `requested_tenure_months` | `36` | Preferred repayment period | Applicant |

The complete dictionary, units, types and allowed values are in `data/input_variables.csv`.

## Test profiles

| Profile | Edge case | Pass | Fail | Unknown | Best public-rule match |
|---|---|---:|---:|---:|---|
| P001 | Strong salaried | 17 | 2 | 1 | Canara Bank |
| P002 | Low CIBIL score | 12 | 7 | 1 | Canara Bank |
| P003 | Very high existing EMI | 13 | 6 | 1 | Axis Bank |
| P004 | Only 3 months in current job | 11 | 8 | 1 | Canara Bank |
| P005 | Established self-employed | 6 | 13 | 1 | ICICI Bank |
| P006 | New self-employed business | 5 | 14 | 1 | IDFC FIRST Bank |
| P007 | Age near maturity limit | 11 | 8 | 1 | Canara Bank |
| P008 | Low monthly income | 5 | 14 | 1 | Canara Bank |
| P009 | No lender relationship | 15 | 4 | 1 | Canara Bank |
| P010 | Age below most limits | 1 | 18 | 1 | Canara Bank |

“Best” means best under the captured public rules for that exact test profile. It is not a recommendation or approval forecast.

Full inputs: `data/test_profiles.json`  
Full outputs: `outputs/test_results.json`  
Compact output: `outputs/test_summary.csv`

## Findings from the test set

- Employment type caused the most failures because many captured products are salaried-only.
- Age and age-at-maturity were frequent blockers.
- Requested amount and tenure now fail when they exceed published limits.
- High existing EMIs sharply reduce the calculated maximum only where a lender publishes FOIR or net-take-home logic.
- Credit score caused fewer failures than expected because only a small number of lenders publish defensible numeric hard cut-offs.
- A missing CIBIL score produces `insufficient_public_data` only for lenders that publish a numeric cut-off; it is never treated as zero.
- Navi stays unknown because no stable official cutoff was found.

## Repository structure

```text
app.py                              Streamlit comparison UI
src/birbal_engine/engine.py         Rule, amount and ranking logic
data/input_variables.csv            Datapoint dictionary
data/lenders.json                   Machine-readable lender catalogue
data/lender_rule_matrix.csv         One row per lender
data/rule_evidence.csv              One row per captured hard rule
data/calculator_observations.csv    Calculator review trail
data/test_profiles.json             Ten edge-case profiles
outputs/test_results.json           Full generated results
outputs/test_summary.csv            Compact test result table
scripts/build_matrix.py             Rebuild tables and sync web data
scripts/generate_outputs.py         Rebuild test outputs
scripts/evaluate_profile.py         Command-line evaluator
tests/test_engine.py                Behavioural test suite
web/dist/                           Static user-facing application
DATA_AUDIT.md                       Conflicts and limitations
```

## Run the user-facing app

No frontend installation is required.

```bash
git clone https://github.com/CRAFTYPROGRAMMER826/Loan-Scoring.git
cd Loan-Scoring
python3 -m http.server 4173 --directory web/dist
```

Open `http://localhost:4173`.

## Run the Python app

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
streamlit run app.py
```

Windows activation:

```powershell
.venv\Scripts\activate
```

## Run one JSON profile

```bash
python3 scripts/evaluate_profile.py examples/profile.json
```

## Rebuild and verify

```bash
python3 scripts/build_matrix.py
python3 scripts/generate_outputs.py
python3 -m unittest discover -s tests -v
node --check web/dist/app.js
```

Expected result: 20 lender rows, 86 sourced rule rows, 10 generated profile outputs and 10 passing tests.


## Limitations

- Public rules are incomplete and can change.
- A public-rule pass is not lender approval.
- Advertised rates are not personalised rates.
- Employer category, city, fraud checks and detailed bureau history may still affect underwriting.
- Some products are relationship-specific or scheme-specific.
- Calculated maximums are available only where public affordability logic exists.
- Conflicted or missing values are shown instead of guessed.

## Next improvements

- Add explicit employer-category and city inputs where official rules differ.
- Add new-to-credit status separately from a numeric CIBIL score.
- Add processing fees and insurance to total-cost comparison.
- Version source snapshots and automatically flag stale pages.
- Replace duplicated browser/Python decision logic with one shared API for production use.

## Disclaimer

Research prototype only. Not financial advice, a loan offer, an approval prediction or a substitute for lender confirmation.
