# Vendor Location Visualization

## Project Goal
Build a simple local website to visualize Canadian non-bank vendor locations from the EY notice creditor list.

## What This Project Contains
- `notice.pdf`: Source PDF provided by user.
- `canadian_non_bank_locations_reviewed.csv`: Validated vendor dataset used for mapping.
- `vendor_map_single_file.html`: Self-contained map app (data + UI in one file).
- `index.html`, `styles.css`, `app.js`: Multi-file map app version.

## Data Scope
- Includes only **Canadian** and **non-bank** entries.
- Includes claim amounts and account numbers where available.
- Current coordinates in `vendor_map_single_file.html` are approximate (city/province-level), intended for quick visualization.

## Run Locally
From this directory:

```bash
python3 -m http.server 4173
```

Open:
- `http://localhost:4173/vendor_map_single_file.html` (recommended single-file app)
- `http://localhost:4173/` (multi-file app)

## Update Workflow
1. Replace or update `canadian_non_bank_locations_reviewed.csv`.
2. Rebuild single-file app (embed updated data/coords).
3. Reload the browser.

## Notes
- This is a lightweight visualization project, not a precise geocoding system.
- If exact addresses are needed, run a dedicated geocoding pass and store lat/lng per row.
