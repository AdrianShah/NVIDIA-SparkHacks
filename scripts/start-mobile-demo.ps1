# Start CivicVox mobile for judges (Expo tunnel + env check)
# Usage: .\scripts\start-mobile-demo.ps1
# Optional: pass Funnel base URL as first argument

param(
    [string]$ApiUrl = $env:EXPO_PUBLIC_API_URL
)

$MobileDir = Join-Path $PSScriptRoot ".." "mobile" | Resolve-Path
$EnvFile = Join-Path $MobileDir ".env"
$ExampleFile = Join-Path $MobileDir ".env.example"

Set-Location $MobileDir

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing mobile dependencies..."
    npm install
}

if (-not (Test-Path $EnvFile)) {
    if (Test-Path $ExampleFile) {
        Copy-Item $ExampleFile $EnvFile
        Write-Host "Created mobile/.env from .env.example — edit EXPO_PUBLIC_API_URL with your Tailscale Funnel URL."
    } else {
        Write-Error "Missing mobile/.env and mobile/.env.example"
        exit 1
    }
}

if ($ApiUrl) {
    $content = Get-Content $EnvFile -Raw
    $wsUrl = $ApiUrl -replace '^https://', 'wss://' -replace '^http://', 'ws://'
    $wsUrl = "$wsUrl/ws/stream"
    if ($content -notmatch 'EXPO_PUBLIC_API_URL=') {
        Add-Content $EnvFile "`nEXPO_PUBLIC_API_URL=$ApiUrl`nEXPO_PUBLIC_WS_URL=$wsUrl"
    }
    Write-Host "Using API: $ApiUrl"
}

Write-Host ""
Write-Host "Starting Expo with tunnel (judges can scan QR on any network)..."
Write-Host "Ensure EXPO_PUBLIC_API_URL in mobile/.env points to your Tailscale Funnel HTTPS URL."
Write-Host ""

npm run start:demo
