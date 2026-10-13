$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Runner = Join-Path $PSScriptRoot "query-studio-local-runner.mjs"
Push-Location $RepoRoot
try {
  & node $Runner @args
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
