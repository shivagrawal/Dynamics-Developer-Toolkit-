[CmdletBinding()]
param(
    [switch]$Setup,
    [switch]$Semantic,
    [string]$SqlQuery = "SELECT TOP 5 accountid, name FROM account ORDER BY name"
)

$ErrorActionPreference = "Stop"
$prefix = "DynamicsDeveloperToolkit.QueryStudio."
$names = @("DATAVERSE_URL", "DATAVERSE_TENANT_ID", "DATAVERSE_CLIENT_ID", "DATAVERSE_CLIENT_SECRET")

if (-not ("QueryStudioCredentialManager" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class QueryStudioCredentialManager {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    private struct CREDENTIAL {
        public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist;
        public UInt32 AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
    }
    [DllImport("Advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool CredWrite(ref CREDENTIAL c, UInt32 flags);
    [DllImport("Advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr ptr);
    [DllImport("Advapi32.dll", EntryPoint="CredFree")]
    private static extern void CredFree(IntPtr buffer);
    public static void Write(string target, string value) {
        byte[] bytes = Encoding.Unicode.GetBytes(value);
        IntPtr blob = Marshal.AllocHGlobal(bytes.Length);
        try {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            CREDENTIAL c = new CREDENTIAL();
            c.Type = 1; c.TargetName = target; c.Comment = "Query Studio local test credentials";
            c.CredentialBlobSize = (UInt32)bytes.Length; c.CredentialBlob = blob;
            c.Persist = 2; c.UserName = Environment.UserName;
            if (!CredWrite(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        } finally { for (int i = 0; i < bytes.Length; i++) Marshal.WriteByte(blob, i, 0); Marshal.FreeHGlobal(blob); Array.Clear(bytes, 0, bytes.Length); }
    }
    public static string Read(string target) {
        IntPtr ptr;
        if (!CredRead(target, 1, 0, out ptr)) {
            int error = Marshal.GetLastWin32Error();
            if (error == 1168) return null;
            throw new System.ComponentModel.Win32Exception(error);
        }
        try {
            CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
            if (c.CredentialBlob == IntPtr.Zero || c.CredentialBlobSize == 0) return "";
            byte[] bytes = new byte[c.CredentialBlobSize];
            try { Marshal.Copy(c.CredentialBlob, bytes, 0, bytes.Length); return Encoding.Unicode.GetString(bytes); }
            finally { Array.Clear(bytes, 0, bytes.Length); }
        } finally { CredFree(ptr); }
    }
}
"@
}

if ($Setup) {
    Write-Host "Credentials are stored in Windows Credential Manager, not in the repository."
    $url = Read-Host "Dataverse URL [https://org81dcff87.crm8.dynamics.com]"
    if ([string]::IsNullOrWhiteSpace($url)) { $url = "https://org81dcff87.crm8.dynamics.com" }
    if ($url -notmatch '^https://[a-zA-Z0-9.-]+\.crm[0-9]+\.dynamics\.com/?$') { throw "Enter a valid HTTPS Dataverse environment URL." }
    $tenant = Read-Host "Microsoft Entra Directory (tenant) ID"
    $client = Read-Host "Application (client) ID"
    if ([string]::IsNullOrWhiteSpace($tenant) -or [string]::IsNullOrWhiteSpace($client)) { throw "Tenant ID and client ID are required." }
    $secure = Read-Host "Application client secret (input hidden)" -AsSecureString
    if ($secure.Length -eq 0) { throw "Client secret cannot be empty." }
    $ptr = [IntPtr]::Zero
    try {
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
        $values = @{
            DATAVERSE_URL = $url.TrimEnd("/")
            DATAVERSE_TENANT_ID = $tenant.Trim()
            DATAVERSE_CLIENT_ID = $client.Trim()
            DATAVERSE_CLIENT_SECRET = $secret
        }
        foreach ($name in $names) { [QueryStudioCredentialManager]::Write($prefix + $name, [string]$values[$name]) }
    } finally {
        if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
        $secret = $null; $values = $null; $secure.Dispose()
    }
    Write-Host "Stored the four credentials for the current Windows user."
    Write-Host "For a live test run, execute this script again without -Setup."
    exit 0
}

$loaded = @{}
$originalEnvironment = @{}
if ($Semantic) {
    if ([string]::IsNullOrWhiteSpace($SqlQuery)) { throw "Semantic mode requires a bounded read-only SQL query." }
    if ($SqlQuery.Length -gt 2000 -or $SqlQuery -match ";|--|/\*|\*/" -or $SqlQuery -notmatch '^\s*SELECT\b' -or $SqlQuery -notmatch '^\s*SELECT\s+(DISTINCT\s+)?TOP\s+(?:[1-9]|1\d|2[0-5])\b') {
        throw "Semantic SQL must be one SELECT with TOP 1-25, no comments or semicolons, and at most 2,000 characters."
    }
}
foreach ($name in $names) {
    $value = [QueryStudioCredentialManager]::Read($prefix + $name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Missing $name. Run: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\query-studio-live.ps1 -Setup"
    }
    $loaded[$name] = $value
}
$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $root "scripts\query-studio-local-runner.mjs"
if (-not (Test-Path -LiteralPath $runner)) { throw "Query Studio runner not found: $runner" }
try {
    foreach ($name in $names) {
        $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
        Set-Item -Path ("Env:" + $name) -Value $loaded[$name]
    }
    $originalEnvironment["SQL_QUERY"] = [Environment]::GetEnvironmentVariable("SQL_QUERY", "Process")
    if ($Semantic) {
        $env:SQL_QUERY = $SqlQuery
        Write-Host "Running offline regressions, read-only Dataverse integration tests, and bounded semantic checks. Audit tests are disabled."
        & node $runner --live --live-semantic
    } else {
        Write-Host "Running offline regressions and read-only Dataverse integration tests. Audit tests are disabled."
        & node $runner --live
    }
    if ($LASTEXITCODE -ne 0) { throw "Query Studio runner failed with exit code $LASTEXITCODE." }
} finally {
    foreach ($name in $names) {
        if ($null -eq $originalEnvironment[$name]) { Remove-Item -Path ("Env:" + $name) -ErrorAction SilentlyContinue }
        else { Set-Item -Path ("Env:" + $name) -Value $originalEnvironment[$name] }
    }
    if ($null -eq $originalEnvironment["SQL_QUERY"]) { Remove-Item Env:SQL_QUERY -ErrorAction SilentlyContinue }
    else { Set-Item Env:SQL_QUERY -Value $originalEnvironment["SQL_QUERY"] }
    $loaded.Clear()
    $originalEnvironment.Clear()
}
