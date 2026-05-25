# Упаковка проекта для загрузки на VPS (без node_modules, .next, ключей DNSSEC).
# Запуск из корня репозитория: .\scripts\package-for-server.ps1
# Результат: dist\dns-editor-deploy.zip

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$OutDir = Join-Path $Root "dist"
$ZipPath = Join-Path $OutDir "dns-editor-deploy.zip"
$Stage = Join-Path $OutDir "dns-editor-stage"

$ExcludeDirs = @(
    "node_modules", ".next", "__pycache__", ".git",
    "dist", "zones\keys", "frontend\node_modules", "frontend\.next"
)
$ExcludeFiles = @(".env", "*.bak", "*.jnl", "*.jbk", "*.signed")

Write-Host "=== Упаковка DNS Editor для сервера ===" -ForegroundColor Cyan
Write-Host "Корень: $Root"

if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Path $Stage | Out-Null

function Should-Skip($relPath) {
    $norm = $relPath -replace '\\', '/'
    foreach ($d in $ExcludeDirs) {
        $dNorm = ($d -replace '\\', '/').TrimEnd('/')
        if ($norm -eq $dNorm -or $norm.StartsWith("$dNorm/")) { return $true }
    }
    $name = Split-Path -Leaf $relPath
    foreach ($pat in $ExcludeFiles) {
        if ($name -like $pat) { return $true }
    }
    return $false
}

$files = Get-ChildItem -Path $Root -Recurse -File -Force |
    Where-Object {
        $rel = $_.FullName.Substring($Root.Length + 1)
        -not (Should-Skip $rel)
    }

foreach ($f in $files) {
    $rel = $f.FullName.Substring($Root.Length + 1)
    $dest = Join-Path $Stage $rel
    $destDir = Split-Path -Parent $dest
    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
    Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
    # Shell-скрипты: только LF (иначе на Linux: $'\r': command not found)
    if ($rel -match '\.(sh|bash)$' -or $rel -match '(^|/)\.env(\.|$)' -or $rel -match '\.env\.') {
        $bytes = [System.IO.File]::ReadAllBytes($dest)
        $text = [System.Text.Encoding]::UTF8.GetString($bytes) -replace "`r`n", "`n" -replace "`r", "`n"
        [System.IO.File]::WriteAllText($dest, $text, [System.Text.UTF8Encoding]::new($false))
    }
}

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }

Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $ZipPath -Force
Remove-Item -Recurse -Force $Stage

$sizeMb = [math]::Round((Get-Item $ZipPath).Length / 1MB, 2)
Write-Host ""
Write-Host "[OK] Архив: $ZipPath ($sizeMb MB)" -ForegroundColor Green
Write-Host ""
Write-Host "На сервере:" -ForegroundColor Yellow
Write-Host "  unzip dns-editor-deploy.zip -d /opt/dns-editor"
Write-Host "  cd /opt/dns-editor"
Write-Host "  chmod +x scripts/deploy.sh scripts/deploy-docker.sh"
Write-Host "  sudo bash scripts/deploy.sh --mode docker --ip ВАШ_IP"
Write-Host "  # если ошибка `$'\r': command not found`:"
Write-Host "  find scripts -name '*.sh' -exec sed -i 's/\r$//' {} +"
Write-Host "  # или native (BIND уже на сервере):"
Write-Host "  sudo bash scripts/deploy.sh --mode native --url https://ваш-домен.ru"
