# Copies the smoke-test fixtures into a UEFN project's Content folder.
# Usage:
#   powershell -File test-fixtures/uefn-smoke/sync.ps1 -ContentPath "C:\...\<Project>\Content"
#
# Copy-only: never deletes anything in the target. Fixture files contain
# deliberate compile errors (missing imports) -- that is the point.

param(
    [Parameter(Mandatory = $true)]
    [string]$ContentPath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $ContentPath)) {
    Write-Error "Content folder not found: $ContentPath"
    exit 1
}

$source = Join-Path $PSScriptRoot "Content"

$files = Get-ChildItem -Path $source -Recurse -File -Filter *.verse
foreach ($file in $files) {
    $relative = $file.FullName.Substring($source.Length).TrimStart("\")
    $target = Join-Path $ContentPath $relative
    $targetDir = Split-Path $target -Parent
    if (-not (Test-Path $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }
    Copy-Item $file.FullName $target -Force
    Write-Host "synced $relative"
}

Write-Host ""
Write-Host "$($files.Count) fixture files synced to $ContentPath"
Write-Host "Reminder: T5 must be re-synced between its ON/OFF runs."
