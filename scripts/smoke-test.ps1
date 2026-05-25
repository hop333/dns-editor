# Smoke-тест API и DNS для diploma-dns
$ErrorActionPreference = "Stop"
$base = "http://localhost:8000"
$zone = "smoke-test.local"
$passed = 0
$failed = 0

function Test-Case($name, $script) {
    try {
        & $script
        Write-Host "[OK] $name" -ForegroundColor Green
        $script:passed++
    } catch {
        Write-Host "[FAIL] $name" -ForegroundColor Red
        Write-Host "       $($_.Exception.Message)" -ForegroundColor Red
        $script:failed++
    }
}

Write-Host "`n=== DNS Editor smoke test ===`n" -ForegroundColor Cyan

Test-Case "GET / (health)" {
    $r = Invoke-RestMethod -Uri "$base/"
    if ($r.status -ne "ok") { throw "status not ok" }
}

Test-Case "GET /zones without auth -> 401" {
    try {
        Invoke-WebRequest -Uri "$base/zones" -UseBasicParsing | Out-Null
        throw "expected 401"
    } catch {
        if ($_.Exception.Response.StatusCode.value__ -ne 401) { throw $_ }
    }
}

$token = $null
Test-Case "POST /auth/login" {
    $body = "username=admin&password=admin"
    $r = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -Body $body -ContentType "application/x-www-form-urlencoded"
    if (-not $r.access_token) { throw "no token" }
    $script:token = $r.access_token
}

$headers = @{ Authorization = "Bearer $token" }

Test-Case "GET /zones (auth)" {
    $r = Invoke-RestMethod -Uri "$base/zones" -Headers $headers
    if (-not $r.zones) { throw "no zones list" }
}

Test-Case "GET /status (BIND)" {
    $r = Invoke-RestMethod -Uri "$base/status" -Headers $headers
    if (-not $r.bind_running) { throw "BIND not running: $($r.error)" }
}

Test-Case "PUT create zone $zone" {
    $payload = @{
        name       = $zone
        type       = "master"
        ttl        = 3600
        adminEmail = "admin@$zone"
        primaryNs  = "ns1.$zone"
        records    = @(
            @{ name = "@"; type = "NS"; value = "ns1.$zone"; ttl = 3600 }
            @{ name = "ns1"; type = "A"; value = "192.0.2.100"; ttl = 3600 }
            @{ name = "@"; type = "A"; value = "192.0.2.50"; ttl = 3600 }
        )
    } | ConvertTo-Json -Depth 5
    $r = Invoke-RestMethod -Uri "$base/zones/$zone/records" -Method Put -Headers $headers -Body $payload -ContentType "application/json; charset=utf-8"
    if ($r.name -ne $zone) { throw "wrong zone name in response" }
}

Test-Case "POST reload zone" {
    $r = Invoke-RestMethod -Uri "$base/zones/$zone/reload" -Method Post -Headers $headers
    if ($r.status -ne "ok") { throw $r.message }
}

Test-Case "DNS dig A record (docker)" {
    $out = docker exec dns-backend dig "@dns-server" $zone A +short 2>&1
    if ($out -notmatch "192\.0\.2\.50") { throw "dig output: $out" }
}

Test-Case "GET dnssec status (disabled)" {
    $r = Invoke-RestMethod -Uri "$base/zones/$zone/dnssec" -Headers $headers
    if ($r.enabled -ne $false) { throw "expected disabled" }
}

Test-Case "POST enable DNSSEC" {
    $r = Invoke-RestMethod -Uri "$base/zones/$zone/dnssec/enable" -Method Post -Headers $headers
    if (-not $r.enabled) { throw "enable failed: $($r | ConvertTo-Json -Compress)" }
}

Test-Case "POST reload after DNSSEC" {
    Invoke-RestMethod -Uri "$base/zones/$zone/reload" -Method Post -Headers $headers | Out-Null
    Start-Sleep -Seconds 6
}

Test-Case "GET dnssec DS or DNSKEY" {
    $r = Invoke-RestMethod -Uri "$base/zones/$zone/dnssec" -Headers $headers
    if (-not $r.enabled) { throw "dnssec not enabled" }
    $ds = docker exec dns-backend dig "@dns-server" $zone DNSKEY +short 2>&1
    if (-not $ds -and $r.ds_records.Count -eq 0) {
        throw "no DNSKEY and no DS in API (may need more time): $($r.message)"
    }
}

Test-Case "POST disable DNSSEC" {
    $r = Invoke-RestMethod -Uri "$base/zones/$zone/dnssec/disable" -Method Post -Headers $headers
    if ($r.enabled -ne $false) { throw "still enabled" }
}

Test-Case "DELETE zone $zone" {
    $r = Invoke-RestMethod -Uri "$base/zones/$zone" -Method Delete -Headers $headers
    if ($r.status -ne "ok") { throw $r.message }
}

Test-Case "Wrong password -> 401" {
    try {
        $body = "username=admin&password=wrong"
        Invoke-RestMethod -Uri "$base/auth/login" -Method Post -Body $body -ContentType "application/x-www-form-urlencoded"
        throw "expected 401"
    } catch {
        if ($_.Exception.Response.StatusCode.value__ -ne 401) { throw $_ }
    }
}

Write-Host "`n=== Results: $passed passed, $failed failed ===`n" -ForegroundColor Cyan
if ($failed -gt 0) { exit 1 }
