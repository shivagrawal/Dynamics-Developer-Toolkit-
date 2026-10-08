# DevLens v5.20.13.1 Metadata Performance Hotfix

Apply over v5.20.13 or v5.20.12.

Changed files:
- `background.js`
- `content-ui.js`
- `manifest.json`
- `ui/metadata-view.js`

Fixes:
- Restores automatic background metadata indexing.
- Restores Global Choice definition loading.
- Global Choice definitions render before usage indexing completes.
- Index status polling no longer redraws the choice tree while indexing is running.
- Expanded choices remain open when the final usage data is rendered.
- Table suggestions match display, logical, and schema names.
- Exact selected-table filtering is retained.
- v5.20.12 Security and Audit Toolkit restoration is retained.
