# Birbal Lens web prototype

Static, dependency-free frontend for the Birbal public-rule screening engine.

The interface can compare all researched lenders or focus on one lending entity. The results include a complete lender table, a green best-fit row, red public-rule failures, unknown-data states, per-lender evidence trails and a three-provider investigation shortlist. Every result exposes the applicant value, published threshold, pass/fail outcome, evidence URL, access date and unresolved advisories. The “How is the screening calculated?” section explains all ten parameter groups in plain English.

The cost view uses standard reducing-balance EMI mathematics with the requested principal and tenure and each matched lender's advertised minimum rate. It shows an illustrative EMI, total interest and interest difference against a comparable shortlisted option. It excludes fees, insurance, taxes, floating-rate changes and personalised pricing, so it is not presented as guaranteed savings.

## Structure

```text
dist/
  index.html             Product narrative and screening interface
  styles.css             Responsive visual system
  app.js                 Browser-side rule evaluation and explanations
  assets/lenders.json    Export of the reviewed lender catalogue
```

## Preview

From the repository root:

```bash
python3 -m http.server 4173 --directory web/dist
```

Open `http://localhost:4173`. The page does not submit applicant values to a server.

When the research catalogue changes, regenerate the CSV outputs and copy `data/lenders.json` to `web/dist/assets/lenders.json` before packaging the site.
