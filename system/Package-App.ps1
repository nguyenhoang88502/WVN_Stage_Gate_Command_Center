#requires -version 3
<#
  Package-App.ps1 — WVN NPI & ECN Command Center packaging script.

  Stages the app bundle, removes the deployment_path from config.json,
  asserts UTF-8 BOM on every .ps1 file (required by PowerShell 5.1), and
  creates the distributable zip.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
# PS 5.1 does not load the compression assemblies by default; without these
# [System.IO.Compression.ZipFile] and [...ZipArchiveMode] are unknown types at
# zip time. They live in two different assemblies - FileSystem carries ZipFile
# and ZipFileExtensions, the base one carries ZipArchive/ZipArchiveMode.
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$ProgressPreference = 'SilentlyContinue'

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$RootDir   = Split-Path -Parent $ScriptDir

$ZipName   = 'WVN_Stage_Gate_Command_Center_ModelOnly_v9.1'
$OutZip    = Join-Path $RootDir "$ZipName.zip"

# --- 1. Stage into a temp directory ---
$StageId  = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$StageDir = Join-Path ([System.IO.Path]::GetTempPath()) "wvn_pkg_$StageId"
Write-Host "Staging to $StageDir ..."

@(
  $StageDir,
  (Join-Path $StageDir 'system'),
  (Join-Path $StageDir 'system\tracking'),
  (Join-Path $StageDir 'system\templates')
) | ForEach-Object {
  if (Test-Path -LiteralPath $_) { Remove-Item -LiteralPath $_ -Recurse -Force }
  New-Item -ItemType Directory -Path $_ -Force | Out-Null
}

# Root-level files
@(
  'Open_WVN_NPI_Command_Center.cmd',
  'Stop_Server.cmd',
  'WVN_Unblock_Files.cmd'
) | ForEach-Object {
  $src = Join-Path $RootDir $_
  if (Test-Path -LiteralPath $src) {
    Copy-Item -LiteralPath $src -Destination (Join-Path $StageDir $_)
    Write-Host "  $_"
  }
  else { Write-Warning "  MISSING: $_" }
}

# System files (frontend + launcher + config)
@(
  'app.js',
  'config.json',
  'index.html',
  'styles.css',
  'launcher.ps1',
  'Stop_WVN_NPI_Command_Center.cmd'
) | ForEach-Object {
  $src = Join-Path $ScriptDir $_
  if (Test-Path -LiteralPath $src) {
    Copy-Item -LiteralPath $src -Destination ((Join-Path $StageDir 'system') + '\' + $_)
    Write-Host "  system\$_"
  }
  else { Write-Warning "  MISSING: system\$_" }
}

# Tracking CSVs (pre-populated sample data)
$TrackingSrc = Join-Path $ScriptDir 'tracking'
if (Test-Path -LiteralPath $TrackingSrc) {
  $trackFiles = Get-ChildItem -LiteralPath $TrackingSrc -File
  if ($trackFiles.Count -gt 0) {
    $trackFiles | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination ((Join-Path $StageDir 'system\tracking') + '\' + $_.Name)
      Write-Host "  system\tracking\$($_.Name)"
    }
  }
  else { Write-Host "  (tracking directory is empty)" }
}
else { Write-Host "  (no tracking directory)" }

# Templates
$TemplatesSrc = Join-Path $ScriptDir 'templates'
if (Test-Path -LiteralPath $TemplatesSrc) {
  Get-ChildItem -LiteralPath $TemplatesSrc -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination ((Join-Path $StageDir 'system\templates') + '\' + $_.Name)
    Write-Host "  system\templates\$($_.Name)"
  }
}

# Vendored Tabler assets — index.html loads these with no CDN fallback
# (the tool runs air-gapped), so a package missing this directory boots to
# an unstyled, half-broken page with no warning anywhere in the console.
$VendorSrc = Join-Path $ScriptDir 'vendor'
if (Test-Path -LiteralPath $VendorSrc) {
  Copy-Item -LiteralPath $VendorSrc -Destination (Join-Path $StageDir 'system\vendor') -Recurse
  Write-Host "  system\vendor\ (Tabler assets)"
}
else { Write-Warning "  MISSING: system\vendor — packaged app.html will load with no styling" }

# --- 2. Sanitise config.json — clear machine-specific paths ---
Write-Host ""
Write-Host "Sanitising config.json — clearing machine-specific paths ..."
$StagedConfig = Join-Path $StageDir 'system\config.json'
$config = Get-Content -Raw -LiteralPath $StagedConfig | ConvertFrom-Json
$config.system_info.deployment_path = ''
if ($config.deployment_defaults.PSObject.Properties.Name -contains 'evidence_vault_path') {
  $config.deployment_defaults.evidence_vault_path = ''
}
if ($config.deployment_defaults.PSObject.Properties.Name -contains 'evidence_vault_root') {
  $config.deployment_defaults.evidence_vault_root = ''
}
$json = $config | ConvertTo-Json -Depth 100
# Preserve original encoding: source config.json is UTF-8 without BOM.
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($StagedConfig, $json, $utf8NoBom)
Write-Host "  deployment_path set to ''"
Write-Host "  evidence_vault_path set to ''"
Write-Host "  evidence_vault_root set to ''"

# --- 3. Assert UTF-8 BOM on every .ps1 file in the package ---
#     PowerShell 5.1 will not parse a .ps1 file without a BOM.
Write-Host ""
Write-Host "Checking UTF-8 BOM on .ps1 files ..."
$utf8Bom = New-Object System.Text.UTF8Encoding $true
Get-ChildItem -LiteralPath $StageDir -Recurse -Filter '*.ps1' | ForEach-Object {
  $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
  if ($bytes.Length -lt 3 -or $bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF) {
    Write-Warning "  $($_.Name) is missing UTF-8 BOM — re-encoding (required by PS 5.1)"
    $content = [System.IO.File]::ReadAllText($_.FullName)
    [System.IO.File]::WriteAllText($_.FullName, $content, $utf8Bom)
  }
  else {
    Write-Host "  $($_.Name) BOM OK"
  }
}

# --- 4. Create zip ---
Write-Host ""
Write-Host "Creating $ZipName.zip ..."
if (Test-Path -LiteralPath $OutZip) { Remove-Item -LiteralPath $OutZip -Force }
# Built entry-by-entry rather than with CreateFromDirectory. On Windows that
# helper writes entry names with backslashes, which the ZIP spec does not allow
# (APPNOTE 4.4.17.1 mandates forward slashes). Explorer and 7-Zip cope, but
# anything else extracts a flat pile of files literally named "system\app.js",
# and the tool will not run from that.
$stageRoot = (Resolve-Path -LiteralPath $StageDir).Path.TrimEnd('\') + '\'
$zipOut = [System.IO.Compression.ZipFile]::Open($OutZip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -LiteralPath $StageDir -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($stageRoot.Length).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zipOut, $_.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal)
  }
} finally { $zipOut.Dispose() }
$sizeKB = [math]::Round((Get-Item -LiteralPath $OutZip).Length / 1KB, 1)
Write-Host "Done: $OutZip ($sizeKB KB)"

# --- 5. Cleanup ---
Remove-Item -LiteralPath $StageDir -Recurse -Force
Write-Host "Staging directory cleaned up."
