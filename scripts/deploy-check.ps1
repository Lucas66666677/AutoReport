param(
  [string]$BackendUrl = $env:VITE_API_URL,
  [switch]$RunBuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $root "frontend"
$backend = Join-Path $root "backend"
$failed = $false

function Write-Check {
  param(
    [string]$Label,
    [bool]$Ok,
    [string]$Detail = ""
  )

  $status = if ($Ok) { "OK" } else { "MISS" }
  $color = if ($Ok) { "Green" } else { "Yellow" }
  Write-Host ("[{0}] {1}" -f $status, $Label) -ForegroundColor $color
  if ($Detail) {
    Write-Host ("     {0}" -f $Detail) -ForegroundColor DarkGray
  }
}

function Test-FileExists {
  param([string]$Path, [string]$Label)
  $exists = Test-Path $Path
  Write-Check $Label $exists $Path
  if (-not $exists) { $script:failed = $true }
}

function Test-EnvName {
  param([string]$Name, [string[]]$EnvFiles)

  $foundInProcess = [Environment]::GetEnvironmentVariable($Name)
  $foundInFile = $false

  foreach ($file in $EnvFiles) {
    if ((Test-Path $file) -and (Select-String -Path $file -Pattern "^$([regex]::Escape($Name))=" -Quiet)) {
      $foundInFile = $true
      break
    }
  }

  Write-Check "env $Name" ($foundInProcess -or $foundInFile) "process env or local .env file"
}

function Invoke-CheckedCommand {
  param([string]$Label, [string]$Command, [string]$WorkingDirectory)

  Write-Host ""
  Write-Host "Running: $Label" -ForegroundColor Cyan
  Push-Location $WorkingDirectory
  try {
    powershell -NoProfile -ExecutionPolicy Bypass -Command $Command
    Write-Check $Label $true
  } catch {
    Write-Check $Label $false $_.Exception.Message
    $script:failed = $true
  } finally {
    Pop-Location
  }
}

Write-Host "AutoLabReport deployment readiness check" -ForegroundColor Cyan
Write-Host "Root: $root" -ForegroundColor DarkGray
Write-Host ""

Test-FileExists (Join-Path $frontend "package.json") "frontend package"
Test-FileExists (Join-Path $frontend "vercel.json") "Vercel SPA rewrite"
Test-FileExists (Join-Path $backend "main.py") "FastAPI backend"
Test-FileExists (Join-Path $backend "requirements.txt") "backend requirements"
Test-FileExists (Join-Path $root ".env.example") "env example"
Test-FileExists (Join-Path $root "supabase\schema_and_rls.sql") "Supabase schema and RLS"
Test-FileExists (Join-Path $root "extension\manifest.json") "Chrome extension manifest"

$envFiles = @(
  (Join-Path $root ".env"),
  (Join-Path $root ".env.local"),
  (Join-Path $frontend ".env"),
  (Join-Path $frontend ".env.local"),
  (Join-Path $backend ".env"),
  (Join-Path $backend ".env.local")
)

Write-Host ""
Write-Host "Environment variables" -ForegroundColor Cyan
foreach ($name in @(
  "VITE_API_URL",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY"
)) {
  Test-EnvName $name $envFiles
}

if (-not $BackendUrl) {
  $BackendUrl = "http://localhost:8000"
}

Write-Host ""
Write-Host "Backend probes: $BackendUrl" -ForegroundColor Cyan
foreach ($path in @("/api/health", "/keep-alive", "/api/billing/config")) {
  try {
    $response = Invoke-RestMethod -Uri ($BackendUrl.TrimEnd("/") + $path) -Method Get -TimeoutSec 10
    Write-Check "GET $path" $true ($response | ConvertTo-Json -Compress)
  } catch {
    Write-Check "GET $path" $false "backend may not be running or URL/env is not deployed yet"
  }
}

if ($RunBuild) {
  Invoke-CheckedCommand "frontend lint" "npm run lint" $frontend
  Invoke-CheckedCommand "frontend production build" "npm run build" $frontend
  Invoke-CheckedCommand "backend python compile" "python -m py_compile backend/main.py" $root
  Invoke-CheckedCommand "extension syntax check" "node --check extension/background.js; node --check extension/content.js; node --check extension/popup.js" $root
}

Write-Host ""
if ($failed) {
  Write-Host "Deployment check finished with required misses." -ForegroundColor Yellow
  exit 1
}

Write-Host "Deployment check finished." -ForegroundColor Green

