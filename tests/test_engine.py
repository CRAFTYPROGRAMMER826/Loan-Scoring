from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from birbal_engine.engine import evaluate_lender, evaluate_profile, load_catalog  # noqa: E402


class EngineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.catalog = {item["lender_id"]: item for item in load_catalog()}
        cls.base = {
            "employment_type": "salaried",
            "age_years": 30,
            "monthly_income_inr": 80000,
            "existing_monthly_emis_inr": 10000,
            "cibil_score": 780,
            "total_work_months": 60,
            "current_job_months": 24,
            "business_vintage_months": 0,
            "relationship_lender_ids": ["L001", "L010"],
            "resident_indian": True,
            "requested_amount_inr": 500000,
            "requested_tenure_months": 36,
        }

    def test_hdfc_age_failure_is_explained(self) -> None:
        profile = dict(self.base, age_years=61)
        result = evaluate_lender(profile, self.catalog["L002"])
        self.assertEqual(result["decision"], "fails_public_rule")
        self.assertTrue(any("age" in reason.lower() for reason in result["failure_reasons"]))

    def test_soft_cibil_does_not_reject_idfc(self) -> None:
        profile = dict(self.base, cibil_score=700)
        result = evaluate_lender(profile, self.catalog["L006"])
        self.assertEqual(result["decision"], "passes_public_rules")

    def test_missing_optional_cibil_is_unknown_only_for_hard_cutoff(self) -> None:
        profile = dict(self.base, cibil_score=None)
        bajaj = evaluate_lender(profile, self.catalog["L014"])
        idfc = evaluate_lender(profile, self.catalog["L006"])
        self.assertEqual(bajaj["decision"], "insufficient_public_data")
        self.assertTrue(any("CIBIL" in reason for reason in bajaj["missing_inputs"]))
        self.assertEqual(idfc["decision"], "passes_public_rules")

    def test_navi_remains_unknown(self) -> None:
        result = evaluate_lender(self.base, self.catalog["L020"])
        self.assertEqual(result["decision"], "insufficient_public_data")

    def test_sbi_foir_produces_public_cap(self) -> None:
        result = evaluate_lender(self.base, self.catalog["L001"])
        self.assertEqual(result["decision"], "passes_public_rules")
        self.assertIsNotNone(result["public_maximum"]["amount_inr"])

    def test_requested_amount_above_public_cap_fails(self) -> None:
        profile = dict(self.base, requested_amount_inr=10_000_000)
        result = evaluate_lender(profile, self.catalog["L001"])
        self.assertEqual(result["decision"], "fails_public_rule")
        self.assertTrue(any("Requested amount" in reason for reason in result["failure_reasons"]))

    def test_requested_tenure_outside_product_range_fails(self) -> None:
        profile = dict(self.base, requested_tenure_months=3)
        result = evaluate_lender(profile, self.catalog["L003"])
        self.assertEqual(result["decision"], "fails_public_rule")
        self.assertTrue(any("tenure" in reason.lower() for reason in result["failure_reasons"]))

    def test_lender_relationship_is_scoped_to_selected_lender(self) -> None:
        profile = dict(self.base, relationship_lender_ids=["L001"])
        sbi = evaluate_lender(profile, self.catalog["L001"])
        rbl = evaluate_lender(profile, self.catalog["L010"])
        self.assertEqual(sbi["decision"], "passes_public_rules")
        self.assertEqual(rbl["decision"], "fails_public_rule")

    def test_catalog_has_twenty_unique_traceable_lenders(self) -> None:
        self.assertEqual(len(self.catalog), 20)
        self.assertEqual(len(set(self.catalog)), 20)
        for lender in self.catalog.values():
            self.assertIn(lender["data_status"], {"verified", "partial", "conflict", "insufficient"})
            self.assertTrue(lender["evidence"], lender["lender_name"])
            for source in lender["evidence"]:
                self.assertTrue(source["url"].startswith("https://"), lender["lender_name"])
                date.fromisoformat(source["accessed_date"])

    def test_all_sample_profiles_are_evaluable(self) -> None:
        profiles = __import__("json").loads((ROOT / "data" / "test_profiles.json").read_text())
        self.assertGreaterEqual(len(profiles), 10)
        for profile in profiles:
            result = evaluate_profile(profile, list(self.catalog.values()))
            self.assertEqual(len(result["lenders"]), 20)
            self.assertIn("approval prediction", result["disclaimer"])


if __name__ == "__main__":
    unittest.main()
