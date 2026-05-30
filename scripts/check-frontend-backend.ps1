# Quick connectivity check: Vercel frontend <-> Tailscale Funnel backend
# Usage: .\scripts\check-frontend-backend.ps1

param(
    [string]$ApiUrl = "https://gx10-4b93.tail00f56a.ts.net",
    [string]$FrontendUrl = "https://delatio.vercel.app"
)

$ErrorActionPreference = "Continue"
$ok = $true

Write-Host "`n=== CivicVox connectivity check ===" -ForegroundColor Cyan
Write-Host "API:      $ApiUrl"
Write-Host "Frontend: $FrontendUrl`n"

function Test-Endpoint {
    param([string]$Label, [string]$Path, [string]$Method = "GET", [string]$Body = $null)
    try {
        $params = @{
            Uri         = "$ApiUrl$Path"
            Method      = $Method
            TimeoutSec  = 15
            UseBasicParsing = $true
            Headers     = @{ Origin = $FrontendUrl }
        }
        if ($Body) {
            $params.Body = $Body
            $params.ContentType = "application/json"
        }
        $r = Invoke-WebRequest @params
        Write-Host "[OK]   $Label -> $($r.StatusCode)" -ForegroundColor Green
        return $true
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        $detail = $_.ErrorDetails.Message
        Write-Host "[FAIL] $Label -> HTTP $code $detail" -ForegroundColor Red
        return $false
    }
}

# 1. Funnel reachable
if (-not (Test-Endpoint "Funnel /docs" "/docs")) { $ok = $false }

# 2. Routes the frontend expects (backend/server.py)
$expected = @("/api/health", "/api/incident")
foreach ($path in $expected) {
    if ($path -eq "/api/incident") {
        $body = '{"transcript":"connectivity check","gps":{"lat":43.6532,"lng":-79.3832}}'
        if (-not (Test-Endpoint "POST $path" $path "POST" $body)) { $ok = $false }
    } else {
        if (-not (Test-Endpoint "GET $path" $path)) { $ok = $false }
    }
}

# 3. OpenAPI route audit
try {
    $spec = (Invoke-WebRequest -Uri "$ApiUrl/openapi.json" -TimeoutSec 10 -UseBasicParsing).Content | ConvertFrom-Json
    $paths = @($spec.paths.PSObject.Properties.Name)
    Write-Host "`nOpenAPI title: $($spec.info.title) v$($spec.info.version)"
    Write-Host "Routes: $($paths -join ', ')"
    if ($paths -notcontains "/api/incident") {
        Write-Host "[WARN] Running gateway does NOT expose /api/incident (frontend will fail)." -ForegroundColor Yellow
        Write-Host "       Start backend/server.py on :8080 and point 'tailscale funnel 8080' at it." -ForegroundColor Yellow
        $ok = $false
    }
} catch {
    Write-Host "[FAIL] Could not read openapi.json" -ForegroundColor Red
    $ok = $false
}

# 4. Frontend bundle env
try {
    $html = (Invoke-WebRequest -Uri $FrontendUrl -TimeoutSec 15 -UseBasicParsing).Content
    if ($html -match "page-([a-f0-9]+)\.js") {
        $chunk = $Matches[1]
        $js = (Invoke-WebRequest -Uri "$FrontendUrl/_next/static/chunks/app/page-$chunk.js" -TimeoutSec 15 -UseBasicParsing).Content
        $apiHost = ($ApiUrl -replace '^https?://', '')
        if ($js -match [regex]::Escape($apiHost)) {
            Write-Host "`n[OK]   Frontend bundle embeds API host: $apiHost" -ForegroundColor Green
        } else {
            Write-Host "`n[FAIL] Frontend bundle missing API host $apiHost - redeploy Vercel." -ForegroundColor Red
            $ok = $false
        }
    }
} catch {
    Write-Host "`n[WARN] Could not verify frontend bundle" -ForegroundColor Yellow
}

Write-Host ""
if ($ok) {
    Write-Host "RESULT: Frontend and backend are aligned." -ForegroundColor Green
    exit 0
} else {
    Write-Host "RESULT: Misconfiguration detected - see failures above." -ForegroundColor Red
    exit 1
}
