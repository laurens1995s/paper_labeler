param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')),
    [string]$SpecPath = 'paper_labeler.spec',
    [string]$DistName = 'paper_labeler',
    [string]$OutDir = 'dist_exe',
    [switch]$Clean,
    [switch]$StopRunning
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Info([string]$Msg) {
    Write-Host $Msg
}

$root = Resolve-Path $ProjectRoot
Set-Location $root

$venvPy = Join-Path $root 'venv\Scripts\python.exe'
$venvPyInstaller = Join-Path $root 'venv\Scripts\pyinstaller.exe'

if (-not (Test-Path $venvPy)) {
    throw ('venv python not found: ' + $venvPy)
}

if ($StopRunning) {
    Info 'Stopping running paper_labeler.exe (if any)...'
    Get-Process -Name 'paper_labeler' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

if ($Clean) {
    Info 'Cleaning build/dist folders...'
    Remove-Item -Recurse -Force (Join-Path $root 'build') -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force (Join-Path $root 'dist') -ErrorAction SilentlyContinue
}

$spec = Join-Path $root $SpecPath
if (-not (Test-Path $spec)) {
    throw ('spec not found: ' + $spec)
}

Info ('Building with spec: ' + $SpecPath)
if (Test-Path $venvPyInstaller) {
    & $venvPyInstaller -y $spec
} else {
    & $venvPy -m PyInstaller -y $spec
}

$builtDistDir = Join-Path $root ('dist\' + $DistName)
if (-not (Test-Path $builtDistDir)) {
    throw ('built dist dir not found: ' + $builtDistDir)
}

$out = Join-Path $root $OutDir
Info ('Syncing output to: ' + $OutDir)
New-Item -ItemType Directory -Force -Path $out | Out-Null
try {
    Copy-Item -Force -Recurse (Join-Path $builtDistDir '*') $out
} catch {
    Info 'Sync failed (files may be locked). Trying to stop running paper_labeler.exe and retry...'
    Get-Process -Name 'paper_labeler' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
    Copy-Item -Force -Recurse (Join-Path $builtDistDir '*') $out
}

$exePath = Join-Path $OutDir 'paper_labeler.exe'
Info ('Done. Run: ' + $exePath)
