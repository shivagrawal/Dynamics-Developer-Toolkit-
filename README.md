# Dynamics 365 & Dataverse DevLens

DevLens is a browser-based developer toolkit for Dynamics 365 and Dataverse. The SQL Query Studio work is developed on the feature branch `feature/sql4cds-query-studio`; `main` remains untouched.

## SQL Query Studio

- Browser-native JavaScript implementation; no .NET runtime dependency.
- Ordinary-table SQL uses the existing Dataverse SQL endpoint path.
- Six security/audit SQL patterns use an explicit Dataverse Web API/FetchXML compatibility adapter.
- Read-only execution, projection validation, fail-closed unsupported-query handling, bounded results, and safe audit-detail concurrency.
- SQL4CDS compatibility is incremental; this is not yet a full T-SQL/SQL4CDS replacement.

### Engineering documentation

- [Architecture and safety contracts](sqlstudio/ARCHITECTURE.md)
- [Security SQL compatibility matrix and test evidence](sqlstudio/SECURITY-QUERY-COMPATIBILITY.md)

### Automated verification

- [Query Studio regression tests](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/workflows/query-studio-regression.yml)
- [Live Dataverse security query integration](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/workflows/security-query-integration.yml)
- [On-demand Dataverse SQL smoke test](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/workflows/dataverse-on-demand-query.yml)

The live integration environment has auditing disabled at organization or account level. The audit-detail adapter has offline fixture coverage; live audit verification is skipped unless auditing is already enabled. Tests do not change environment-wide audit settings automatically.

---

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
