# One-time Query Studio credentials on Windows

This helper stores the Dataverse URL, tenant ID, application ID, and client secret in Windows Credential Manager for the current Windows user. It does not store them in Git or persistent environment variables.

From the repository root, run once:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\query-studio-live.ps1 -Setup
```

Enter the tenant ID and application ID when prompted. The client secret is entered in a hidden secure prompt. The URL defaults to the configured development environment.

For each later manual read-only live test run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\query-studio-live.ps1
```

The helper loads credentials into the process environment only while invoking the runner with `--live`, then removes those environment variables. It never enables semantic or audit tests. Audit tests remain disabled.

To remove stored entries, open Control Panel → Credential Manager → Windows Credentials and delete entries beginning `DynamicsDeveloperToolkit.QueryStudio.`.

Run only on a trusted Windows user account. Windows Credential Manager protects credentials at rest for that user, but the secret must be available briefly to the local test process.