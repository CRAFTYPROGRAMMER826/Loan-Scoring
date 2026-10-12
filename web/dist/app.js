const state = { lenders: [], results: [], filter: "all" };

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

function toast(message) {
  const element = qs("#toast");
  element.textContent = message;
  element.classList.add("show");
  window.setTimeout(() => element.classList.remove("show"), 2200);
}

function hardRules(lender, employmentType) {
  return [
    ...(lender.rules || []),
    ...((lender.segment_rules || {})[employmentType] || []),
  ].filter((rule) => rule.strength === "hard");
}

function formatRuleValue(field, value) {
  if (value === undefined || value === null || value === "") return "Not provided";
  if (Array.isArray(value)) return value.map((item) => formatRuleValue(field, item)).join(" or ");
  if (field === "monthly_income_inr") return `${inr.format(Number(value))} per month`;
  if (field === "requested_amount_inr") return inr.format(Number(value));
  if (field === "age_years" || field === "age_at_maturity_years") return `${Number(value).toFixed(field === "age_at_maturity_years" ? 1 : 0)} years`;
  if (["total_work_months", "current_job_months", "business_vintage_months", "requested_tenure_months"].includes(field)) return `${value} months`;
  if (field === "cibil_score") return `${value} points`;
  if (["salary_account_with_lender", "resident_indian"].includes(field)) return value ? "Yes" : "No";
  if (field === "employment_type") return String(value).replaceAll("_", "-");
  return String(value);
}

function requirementText(rule) {
  const label = rule.label || rule.field.replaceAll("_", " ");
  const expected = formatRuleValue(rule.field, rule.value);
  if (rule.operator === ">=") return `${label}: minimum ${expected}`;
  if (rule.operator === "<=") return `${label}: maximum ${expected}`;
  if (rule.operator === "=") return `${label}: must be ${expected}`;
  if (rule.operator === "in") return `${label}: must be ${expected}`;
  return `${label}: ${rule.operator} ${expected}`;
}

function checkRule(profile, rule) {
  const actual = profile[rule.field];
  const expected = rule.value;
  const label = rule.label || rule.field.replaceAll("_", " ");
  if (actual === undefined || actual === null || actual === "") {
    return {
      rule,
      ok: false,
      missing: true,
      requirement: requirementText(rule),
      actual: "Not provided",
      reason: `Missing applicant value: ${label}.`,
    };
  }

  let ok = false;
  if (rule.operator === ">=") ok = Number(actual) >= Number(expected);
  if (rule.operator === "<=") ok = Number(actual) <= Number(expected);
  if (rule.operator === "=") ok = actual === expected;
  if (rule.operator === "in") ok = expected.includes(actual);

  const operatorText = { ">=": "at least", "<=": "not exceed", "=": "equal" }[rule.operator] || "one of";
  return {
    rule,
    ok,
    missing: false,
    requirement: requirementText(rule),
    actual: formatRuleValue(rule.field, actual),
    reason: `${label} must ${operatorText} ${formatRuleValue(rule.field, expected)}; applicant value is ${formatRuleValue(rule.field, actual)}.`,
  };
}

function presentValue(emi, annualRate, months) {
  if (emi <= 0 || months <= 0) return 0;
  const monthlyRate = annualRate / 1200;
  if (!monthlyRate) return emi * months;
  return emi * (1 - Math.pow(1 + monthlyRate, -months)) / monthlyRate;
}

function publicMaximum(profile, lender) {
  const product = lender.product || {};
  const affordability = lender.affordability || {};
  const caps = [];
  if (product.max_amount_inr) caps.push({ basis: "advertised product maximum", value: Number(product.max_amount_inr) });

  const income = Number(profile.monthly_income_inr || 0);
  const existingEmis = Number(profile.existing_monthly_emis_inr || 0);
  const months = Math.min(Number(profile.requested_tenure_months || 0), Number(product.max_tenure_months || 0));
  if (affordability.foir_cap_pct != null && product.min_rate_pct != null && months) {
    const emi = Math.max(0, income * affordability.foir_cap_pct / 100 - existingEmis);
    caps.push({ basis: "published FOIR affordability", value: presentValue(emi, product.min_rate_pct, months) });
  }
  if (affordability.min_residual_income_pct != null && affordability.min_residual_income_inr != null && product.min_rate_pct != null && months) {
    const requiredResidual = Math.max(
      income * Number(affordability.min_residual_income_pct) / 100,
      Number(affordability.min_residual_income_inr),
    );
    const emi = Math.max(0, income - existingEmis - requiredResidual);
    caps.push({ basis: "published minimum net-take-home rule", value: presentValue(emi, product.min_rate_pct, months) });
  }
  if (affordability.salary_multiple != null && income) {
    caps.push({ basis: "published salary multiple", value: income * affordability.salary_multiple });
  }
  if (caps.length <= 1) return { amount: null, basis: "not publicly determinable", advertised: product.max_amount_inr || null };
  const winner = caps.sort((a, b) => a.value - b.value)[0];
  return { amount: Math.floor(winner.value / 1000) * 1000, basis: winner.basis, advertised: product.max_amount_inr || null };
}

function evaluate(profile, lender) {
  const computed = {
    ...profile,
    age_at_maturity_years: Number(profile.age_years) + Number(profile.requested_tenure_months) / 12,
    salary_account_with_lender: (profile.relationship_lender_ids || []).includes(lender.lender_id),
  };
  const failures = [];
  const missing = [];
  const ruleChecks = [];
  const supported = lender.supported_employment_types || [];
  if (supported.length) {
    const employmentCheck = checkRule(computed, {
      field: "employment_type",
      operator: "in",
      value: supported,
      label: "Supported employment type",
      strength: "hard",
    });
    ruleChecks.push(employmentCheck);
  }

  hardRules(lender, profile.employment_type).forEach((rule) => {
    const result = checkRule(computed, rule);
    ruleChecks.push(result);
  });

  const maximum = publicMaximum(profile, lender);
  const applicableCap = maximum.amount ?? maximum.advertised;
  if (applicableCap != null) {
    ruleChecks.push(checkRule(computed, {
      field: "requested_amount_inr",
      operator: "<=",
      value: applicableCap,
      label: maximum.amount != null ? "Requested amount vs applicant public maximum" : "Requested amount vs advertised product maximum",
      strength: "hard",
    }));
  }
  if (lender.product?.min_tenure_months != null) {
    ruleChecks.push(checkRule(computed, {
      field: "requested_tenure_months",
      operator: ">=",
      value: lender.product.min_tenure_months,
      label: "Requested tenure",
      strength: "hard",
    }));
  }
  if (lender.product?.max_tenure_months != null) {
    ruleChecks.push(checkRule(computed, {
      field: "requested_tenure_months",
      operator: "<=",
      value: lender.product.max_tenure_months,
      label: "Requested tenure",
      strength: "hard",
    }));
  }

  ruleChecks.forEach((result) => {
    if (!result.ok && result.missing) missing.push(result.reason);
    else if (!result.ok) failures.push(result.reason);
  });

  let decision = "passes_public_rules";
  if (failures.length) decision = "fails_public_rule";
  else if (lender.data_status === "insufficient" || missing.length) decision = "insufficient_public_data";

  return {
    ...lender,
    decision,
    failures,
    missing,
    rule_checks: ruleChecks,
    maximum,
  };
}

function profileFromForm(form) {
  const formData = new FormData(form);
  const requiredNumeric = [
    "age_years", "monthly_income_inr", "existing_monthly_emis_inr",
    "total_work_months", "current_job_months", "business_vintage_months",
    "requested_amount_inr", "requested_tenure_months",
  ];
  const profile = Object.fromEntries(formData.entries());
  requiredNumeric.forEach((field) => { profile[field] = Number(profile[field] || 0); });
  const cibil = formData.get("cibil_score");
  profile.cibil_score = cibil === null || cibil.trim() === "" ? null : Number(cibil);
  profile.relationship_lender_ids = formData.getAll("relationship_lender_ids");
  profile.resident_indian = true;
  return profile;
}

function rank(results, requestedAmount) {
  return [...results].filter((item) => item.decision === "passes_public_rules").sort((a, b) => {
    const capacityA = a.maximum?.amount ?? a.maximum?.advertised ?? 0;
    const capacityB = b.maximum?.amount ?? b.maximum?.advertised ?? 0;
    const coversA = capacityA >= requestedAmount ? 0 : 1;
    const coversB = capacityB >= requestedAmount ? 0 : 1;
    if (coversA !== coversB) return coversA - coversB;
    const evidenceOrder = { verified: 0, partial: 1, conflict: 2, insufficient: 3 };
    const evidenceA = evidenceOrder[a.data_status] ?? 4;
    const evidenceB = evidenceOrder[b.data_status] ?? 4;
    if (evidenceA !== evidenceB) return evidenceA - evidenceB;
    return (a.product?.min_rate_pct ?? 999) - (b.product?.min_rate_pct ?? 999);
  });
}

function decisionMeta(decision) {
  if (decision === "passes_public_rules") return { label: "Public rules pass", className: "pass" };
  if (decision === "fails_public_rule") return { label: "Public rule fails", className: "fail" };
  return { label: "Not enough data", className: "unknown" };
}

function rateLabel(item) {
  const min = item.product?.min_rate_pct;
  const max = item.product?.max_rate_pct;
  if (min == null && max == null) return "Rate unknown";
  if (min != null && max != null) return `${min}%–${max}% advertised`;
  if (min != null) return `${min}%+ advertised`;
  return `Up to ${max}% advertised`;
}

function maximumLabel(item) {
  if (!item.maximum) return "Not evaluated";
  if (item.maximum.amount != null) return inr.format(item.maximum.amount);
  if (item.maximum.advertised != null) return `Advertised up to ${inr.format(item.maximum.advertised)}; personal cap unknown`;
  return "Not determinable";
}

function tenureLabel(product = {}) {
  const min = product.min_tenure_months;
  const max = product.max_tenure_months;
  if (min != null && max != null) return `${min}–${max} months`;
  if (max != null) return `Up to ${max} months`;
  if (min != null) return `${min}+ months`;
  return "Not published";
}

function costProjection(item, profile) {
  const principal = Number(profile.requested_amount_inr || 0);
  const months = Number(profile.requested_tenure_months || 0);
  const rate = Number(item.product?.min_rate_pct);
  const amountLimit = item.maximum?.amount ?? item.maximum?.advertised;
  const minimumTenure = item.product?.min_tenure_months;
  const maximumTenure = item.product?.max_tenure_months;
  if (!principal || !months || !rate || !amountLimit || principal > amountLimit) return null;
  if (minimumTenure != null && months < minimumTenure) return null;
  if (maximumTenure == null || months > maximumTenure) return null;
  const monthlyRate = rate / 1200;
  const factor = Math.pow(1 + monthlyRate, months);
  const emi = principal * monthlyRate * factor / (factor - 1);
  const totalRepayment = emi * months;
  return {
    principal,
    months,
    rate,
    emi,
    total_repayment: totalRepayment,
    total_interest: totalRepayment - principal,
  };
}

function savingsPanel(best, ranked, profile) {
  const bestCost = costProjection(best, profile);
  if (!bestCost) return `<div class="savings-panel unavailable"><strong>Cost estimate unavailable</strong><p>A comparable starting rate, amount limit and tenure were not all publicly available for this product.</p></div>`;
  const comparison = ranked.slice(1).map((item) => ({ item, cost: costProjection(item, profile) }))
    .find(({ cost }) => cost && cost.total_interest > bestCost.total_interest);
  const difference = comparison ? comparison.cost.total_interest - bestCost.total_interest : null;
  const differencePct = comparison ? difference / comparison.cost.total_interest * 100 : null;
  return `<div class="savings-panel">
    <div class="savings-title"><span>Illustrative cost view</span><strong>Using advertised minimum rates</strong></div>
    <div class="savings-metrics">
      <div><small>Estimated EMI</small><strong>${inr.format(Math.round(bestCost.emi))}<i>/month</i></strong></div>
      <div><small>Total interest over ${bestCost.months} months</small><strong>${inr.format(Math.round(bestCost.total_interest))}</strong></div>
      <div><small>${comparison ? `Interest difference vs ${comparison.item.lender_name}` : "Interest comparison"}</small><strong>${comparison ? inr.format(Math.round(difference)) : "No higher-cost comparable match"}</strong>${comparison ? `<i>${differencePct.toFixed(1)}% lower illustrative interest cost</i>` : ""}</div>
    </div>
    <p>Same principal (${inr.format(bestCost.principal)}) and tenure (${bestCost.months} months). ${comparison ? `The estimate compares ${bestCost.rate}% with ${comparison.cost.rate}%.` : "No savings claim is made without a comparable matched option."} Fees, insurance, taxes and personalised rates are excluded.</p>
  </div>`;
}

function sourceHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return "official source"; }
}

function ruleProof(check, source) {
  const stateClass = check.missing ? "missing" : check.ok ? "pass" : "fail";
  const symbol = check.missing ? "?" : check.ok ? "✓" : "×";
  return `<div class="rule-proof ${stateClass}">
    <span>${symbol}</span>
    <div><strong>${check.requirement}</strong><small>Applicant value: ${check.actual}</small></div>
    ${source ? `<a href="${source.url}" target="_blank" rel="noreferrer" title="${source.url}">Evidence ↗</a>` : ""}
  </div>`;
}

function lenderDetails(item, open = false) {
  const meta = decisionMeta(item.decision);
  const primarySource = (item.evidence || [])[0];
  const failedChecks = (item.rule_checks || []).filter((check) => !check.ok);
  const passedChecks = (item.rule_checks || []).filter((check) => check.ok);
  const explanation = item.decision === "passes_public_rules"
    ? `All ${passedChecks.length} captured hard requirements were met. Internal underwriting may still reject the application.`
    : item.decision === "fails_public_rule"
      ? `${failedChecks.length} captured public requirement${failedChecks.length === 1 ? " was" : "s were"} not met.`
      : item.missing.length
        ? `No rejection was inferred. ${item.missing.length} applicant value${item.missing.length === 1 ? " is" : "s are"} missing, so the published rule cannot be tested.`
        : "The public information is not stable or complete enough to make a defensible eligibility claim.";
  const advisories = (item.advisories || []).map((note) => `<li>${note}</li>`).join("");
  const sources = (item.evidence || []).map((source) => `
    <div class="source-item">
      <a href="${source.url}" target="_blank" rel="noreferrer">${source.label || "Official lender source"} — ${sourceHost(source.url)} ↗</a>
      <small>${source.url} · accessed ${source.accessed_date || "date recorded in dataset"}</small>
    </div>`).join("");
  return `
    <details class="lender-result" id="detail-${item.lender_id}" data-decision="${meta.className}" ${open ? "open" : ""}>
      <summary>
        <span class="lender-name"><strong>${item.lender_name}</strong><small>${item.product_name} · ${item.data_status} evidence · ${passedChecks.length}/${item.rule_checks.length} rules met</small></span>
        <span class="decision-chip ${meta.className}">${meta.label}</span>
        <span class="rate-cell">${rateLabel(item)}</span>
        <span class="chevron">⌄</span>
      </summary>
      <div class="result-detail">
        <div class="result-proof-head"><div><strong>Why this result</strong><p>${explanation}</p></div><span class="decision-chip ${meta.className}">${meta.label}</span></div>
        ${failedChecks.length ? `<div class="proof-section-title">Requirements not met</div><div class="rule-proof-list">${failedChecks.map((check) => ruleProof(check, primarySource)).join("")}</div>` : ""}
        ${passedChecks.length ? `<div class="proof-section-title">Requirements met</div><div class="rule-proof-list">${passedChecks.map((check) => ruleProof(check, primarySource)).join("")}</div>` : ""}
        ${item.maximum ? `<p><strong>Public maximum:</strong> ${maximumLabel(item)} · ${item.maximum.basis}</p>` : ""}
        ${advisories ? `<strong>Advisories</strong><ul>${advisories}</ul>` : ""}
        <div class="source-panel"><strong>Official evidence used for this lender</strong>${sources || "<p>No stable public source captured.</p>"}</div>
      </div>
    </details>`;
}

function comparisonRow(item, best) {
  const meta = decisionMeta(item.decision);
  const passed = item.rule_checks.filter((check) => check.ok).length;
  const total = item.rule_checks.length;
  const source = (item.evidence || [])[0];
  const rowClass = best?.lender_id === item.lender_id
    ? "best-fit"
    : item.decision === "fails_public_rule"
      ? "ineligible"
      : item.decision === "insufficient_public_data" ? "unknown" : "eligible";
  const resultLabel = rowClass === "best-fit" ? "Best fit" : meta.label;
  return `<tr class="${rowClass}">
    <td><span class="table-status ${meta.className}">${rowClass === "best-fit" ? "★" : meta.className === "pass" ? "✓" : meta.className === "fail" ? "×" : "?"}</span></td>
    <td><strong>${item.lender_name}</strong><small>${item.product_name}</small></td>
    <td><span class="table-decision ${meta.className}">${resultLabel}</span><small>${item.data_status} evidence</small></td>
    <td><strong>${passed}/${total}</strong><small>hard rules met</small></td>
    <td>${rateLabel(item)}</td>
    <td>${maximumLabel(item)}</td>
    <td>${item.cost_projection ? `<strong>${inr.format(Math.round(item.cost_projection.total_interest))}</strong><small>${item.cost_projection.months} months at ${item.cost_projection.rate}%</small>` : `<span class="not-comparable">Not comparable</span>`}</td>
    <td>${source ? `<a href="${source.url}" target="_blank" rel="noreferrer">Source ↗</a>` : "No stable source"}<a href="#detail-${item.lender_id}">Reasons ↓</a></td>
  </tr>`;
}

function shortlistCard(item, index) {
  const source = (item.evidence || [])[0];
  const passed = item.rule_checks.filter((check) => check.ok);
  return `<article class="shortlist-card ${index === 0 ? "lead" : ""}">
    <span class="shortlist-rank">${index === 0 ? "Best fit" : `Option ${index + 1}`}</span>
    <div class="shortlist-title"><h4>${item.lender_name}</h4><span>${item.data_status}</span></div>
    <p>${passed.slice(0, 3).map((check) => check.requirement).join(" · ") || "No stable hard requirements captured."}</p>
    <div class="shortlist-metrics"><span><small>Advertised rate</small>${rateLabel(item)}</span><span><small>Total interest</small>${item.cost_projection ? inr.format(Math.round(item.cost_projection.total_interest)) : "Not comparable"}</span></div>
    ${source ? `<a href="${source.url}" target="_blank" rel="noreferrer">Review official evidence ↗</a>` : ""}
  </article>`;
}

function renderResults(profile) {
  const candidates = profile.lender_id === "all"
    ? state.lenders
    : state.lenders.filter((lender) => lender.lender_id === profile.lender_id);
  const results = candidates.map((lender) => evaluate(profile, lender));
  results.forEach((item) => { item.cost_projection = costProjection(item, profile); });
  state.results = results;
  const ranked = rank(results, profile.requested_amount_inr);
  const best = ranked[0];
  const ordered = [
    ...ranked,
    ...results.filter((item) => item.decision === "insufficient_public_data"),
    ...results.filter((item) => item.decision === "fails_public_rule"),
  ];
  const counts = {
    pass: results.filter((r) => r.decision === "passes_public_rules").length,
    fail: results.filter((r) => r.decision === "fails_public_rule").length,
    unknown: results.filter((r) => r.decision === "insufficient_public_data").length,
  };

  const bestMarkup = best ? `
    <div class="best-card">
      <span class="best-label">Best indicative public-rule match</span>
      <div class="best-title"><h4>${best.lender_name}</h4><span>${best.data_status} evidence</span></div>
      <div class="best-metrics">
        <div><small>Advertised rate</small><strong>${rateLabel(best)}</strong></div>
        <div><small>Public maximum</small><strong>${maximumLabel(best)}</strong></div>
        <div><small>Tenure range</small><strong>${tenureLabel(best.product)}</strong></div>
      </div>
      <div class="best-proof">
        <strong>Why it appears here</strong>
        <p>${best.rule_checks.filter((check) => check.ok).slice(0, 3).map((check) => `✓ ${check.requirement}; applicant: ${check.actual}`).join(" · ")}</p>
        ${(best.evidence || [])[0] ? `<a href="${best.evidence[0].url}" target="_blank" rel="noreferrer">Open the official evidence — ${sourceHost(best.evidence[0].url)} ↗</a>` : ""}
      </div>
      ${savingsPanel(best, ranked, profile)}
    </div>` : `<div class="best-card"><span class="best-label">No public-rule match</span><div class="best-title"><h4>No lender passed all captured hard rules.</h4></div></div>`;

  const resultHeading = results.length === 1
    ? `${results[0].lender_name}: ${decisionMeta(results[0].decision).label}.`
    : counts.pass ? `${counts.pass} possible paths to inspect.` : "The public rules found a blocker.";
  const universeCopy = results.length === state.lenders.length
    ? `This analysis checks exactly the ${state.lenders.length} personal-loan lenders in the researched dataset. It does not search providers outside this list.`
    : `Focused analysis for 1 selected lender from the ${state.lenders.length}-lender researched dataset.`;

  qs("#result-content").innerHTML = `
    <div class="results-topline">
      <div><small>Your personal-loan screening results</small><h3>${resultHeading}</h3></div>
      <button class="new-check" id="new-check">Edit profile</button>
    </div>
    <div class="universe-note"><span>20</span><p><strong>Defined lender universe</strong>${universeCopy}</p></div>
    <div class="result-summary">
      <div class="summary-tile pass"><strong>${counts.pass}</strong><span>pass captured<br />public rules</span></div>
      <div class="summary-tile fail"><strong>${counts.fail}</strong><span>fail at least<br />one public rule</span></div>
      <div class="summary-tile unknown"><strong>${counts.unknown}</strong><span>need more<br />public evidence</span></div>
    </div>
    ${bestMarkup}
    <p class="result-disclaimer">Indicative comparison only. “Pass” means no captured hard public rule failed—not that the lender will approve, price or offer this amount.</p>
    <section class="comparison-block">
      <div class="comparison-heading"><div><small>Complete comparison</small><h4>${results.length} lender${results.length === 1 ? "" : "s"} checked</h4></div><div class="comparison-legend"><span class="green-dot">Best fit</span><span class="red-dot">Ineligible</span><span class="gray-dot">Unknown</span></div></div>
      <div class="table-scroll">
        <table class="comparison-table">
          <thead><tr><th></th><th>Lender and product</th><th>Screening result</th><th>Rules</th><th>Advertised rate</th><th>Public maximum</th><th>Illustrative interest</th><th>Evidence</th></tr></thead>
          <tbody>${ordered.map((item) => comparisonRow(item, best)).join("")}</tbody>
        </table>
      </div>
    </section>
    <section class="evidence-breakdown">
      <div class="comparison-heading"><div><small>Audit trail</small><h4>Why each lender received this result</h4></div></div>
      <div class="result-tabs" role="tablist">
        <button class="active" data-filter="all">All ${results.length}</button>
        <button data-filter="pass">Public rules pass ${counts.pass}</button>
        <button data-filter="fail">Rule fails ${counts.fail}</button>
        <button data-filter="unknown">Unknown ${counts.unknown}</button>
      </div>
      <div class="lender-results ${results.length === 1 ? "single" : ""}">${ordered.map((item, index) => lenderDetails(item, results.length === 1 || index === 0)).join("")}</div>
    </section>
    <section class="shortlist-section">
      <div class="comparison-heading"><div><small>End of analysis</small><h4>Providers to investigate first</h4></div><p>Ranked using requested-amount coverage, evidence quality and advertised starting rate—not guaranteed approval.</p></div>
      <div class="shortlist-grid">${ranked.length ? ranked.slice(0, 3).map(shortlistCard).join("") : `<div class="empty-shortlist">No provider passed all captured public rules for this profile.</div>`}</div>
    </section>`;

  qs("#new-check").addEventListener("click", () => showStep(1));
  qsa("[data-filter]").forEach((button) => button.addEventListener("click", () => filterResults(button.dataset.filter, button)));
}

function filterResults(filter, button) {
  qsa("[data-filter]").forEach((item) => item.classList.toggle("active", item === button));
  qsa(".lender-result").forEach((item) => {
    item.hidden = filter !== "all" && item.dataset.decision !== filter;
  });
}

function showStep(step) {
  qs("#results").hidden = step !== 3;
  qs("#eligibility-form").hidden = step === 3;
  qsa(".form-step").forEach((element) => element.classList.toggle("active", Number(element.dataset.step) === step));
  qsa("[data-step-marker]").forEach((marker) => {
    const markerStep = Number(marker.dataset.stepMarker);
    marker.classList.toggle("active", markerStep === step);
    marker.classList.toggle("complete", markerStep < step);
    if (markerStep < step) qs(":scope > span", marker).textContent = "✓";
    else qs(":scope > span", marker).textContent = markerStep;
  });
}

function switchEmployment(type) {
  qsa(".salaried-field").forEach((field) => { field.hidden = type !== "salaried"; });
  qsa(".business-field").forEach((field) => { field.hidden = type !== "self_employed"; });
}

function updateRanges() {
  const form = qs("#eligibility-form");
  qs("#amount-output").textContent = inr.format(Number(form.elements.requested_amount_inr.value));
  qs("#tenure-output").textContent = `${form.elements.requested_tenure_months.value} months`;
}

function resetSample() {
  const form = qs("#eligibility-form");
  form.reset();
  switchEmployment("salaried");
  updateRanges();
  toast("Sample profile restored");
}

function renderDataset() {
  const statuses = state.lenders.reduce((map, lender) => {
    map[lender.data_status] = (map[lender.data_status] || 0) + 1;
    return map;
  }, {});
  const ruleCount = state.lenders.reduce((sum, lender) => {
    const base = (lender.rules || []).filter((r) => r.strength === "hard").length;
    const segments = Object.values(lender.segment_rules || {}).flat().filter((r) => r.strength === "hard").length;
    return sum + base + segments;
  }, 0);
  qs("#stat-lenders").textContent = state.lenders.length;
  qs("#stat-rules").textContent = ruleCount;
  qs("#stat-verified").textContent = statuses.verified || 0;
  qs("#coverage-stack").innerHTML = [
    ["verified", "Verified", "Current official evidence captured", "green"],
    ["partial", "Partial", "Useful rules; terms still incomplete", "amber"],
    ["conflict", "Conflict", "Official statements disagree", "orange"],
    ["insufficient", "Insufficient", "No defensible public cut-off", "gray"],
  ].map(([key, label, copy, color]) => `<article><span class="coverage-count">${statuses[key] || 0}</span><div><strong>${label}</strong><small>${copy}</small></div><i class="${color}"></i></article>`).join("");
  qs("#lender-ticker").innerHTML = state.lenders.map((lender) => `<span>${lender.lender_name}</span>`).join("");
  qs("#lender-directory-grid").innerHTML = state.lenders.map((lender) => {
    const source = (lender.evidence || [])[0];
    return `<article class="directory-card status-${lender.data_status}">
      <div><span>${lender.lender_id}</span><strong>${lender.lender_name}</strong></div>
      <p>${lender.product_name}</p>
      <footer><span>${lender.data_status}</span>${source ? `<a href="${source.url}" target="_blank" rel="noreferrer">Official source ↗</a>` : ""}</footer>
    </article>`;
  }).join("");
  qs("#lender-select").innerHTML = `<option value="all">Compare all ${state.lenders.length} lenders</option>${state.lenders.map((lender) => `<option value="${lender.lender_id}">${lender.lender_name} — ${lender.product_name}</option>`).join("")}`;
}

async function init() {
  try {
    const response = await fetch("./assets/lenders.json");
    if (!response.ok) throw new Error("Dataset could not be loaded");
    state.lenders = await response.json();
    renderDataset();
  } catch (error) {
    console.error(error);
    toast("Could not load the lender dataset");
  }

  qsa("[data-scroll-to]").forEach((button) => button.addEventListener("click", () => {
    qs(`#${button.dataset.scrollTo}`)?.scrollIntoView({ behavior: "smooth" });
  }));
  qsa('input[name="employment_type"]').forEach((input) => input.addEventListener("change", () => switchEmployment(input.value)));
  qs("#load-sample").addEventListener("click", resetSample);
  qs(".next-step").addEventListener("click", () => {
    const fields = qsa('[data-step="1"] input[required]').filter((input) => !input.closest("[hidden]"));
    if (!fields.every((input) => input.reportValidity())) return;
    showStep(2);
  });
  qs(".prev-step").addEventListener("click", () => showStep(1));
  qsa('input[type="range"]').forEach((input) => input.addEventListener("input", updateRanges));
  updateRanges();

  qs("#eligibility-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.lenders.length) return toast("The dataset is still loading");
    const profile = profileFromForm(event.currentTarget);
    showStep(3);
    qs("#result-loading").hidden = false;
    qs("#result-content").hidden = true;
    window.setTimeout(() => {
      renderResults(profile);
      qs("#result-loading").hidden = true;
      qs("#result-content").hidden = false;
    }, 850);
  });
}

document.addEventListener("DOMContentLoaded", init);
