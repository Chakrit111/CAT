# ============================================
# Cat Prompt PWA — Deploy to GitHub Pages
# สำหรับ Windows PowerShell
# วิธีรัน: คลิกขวาที่ไฟล์ → "Run with PowerShell"
# ============================================

Write-Host ""
Write-Host "🐾 Cat Prompt PWA — GitHub Pages Deployer" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: GitHub username ──
$GH_USER = Read-Host "👤 GitHub username ของคุณ"
if (-not $GH_USER) { Write-Host "❌ กรุณาใส่ username" -ForegroundColor Red; pause; exit }

# ── Step 2: Repo name ──
$REPO_INPUT = Read-Host "📦 ชื่อ repo (กด Enter ใช้ชื่อ: cat-prompt-pwa)"
$REPO_NAME = if ($REPO_INPUT) { $REPO_INPUT } else { "cat-prompt-pwa" }

# ── Step 3: Token ──
Write-Host ""
Write-Host "🔑 ต้องการ GitHub Personal Access Token" -ForegroundColor Yellow
Write-Host "   วิธีสร้าง token:" -ForegroundColor Gray
Write-Host "   1. ไปที่ github.com → Settings → Developer settings" -ForegroundColor Gray
Write-Host "   2. Personal access tokens → Tokens (classic)" -ForegroundColor Gray
Write-Host "   3. Generate new token → ติ๊ก 'repo' → Generate" -ForegroundColor Gray
Write-Host ""
$SecureToken = Read-Host "🔑 วาง token ที่นี่" -AsSecureString
$GH_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
)
if (-not $GH_TOKEN) { Write-Host "❌ กรุณาใส่ token" -ForegroundColor Red; pause; exit }

Write-Host ""
Write-Host "⏳ กำลัง deploy..." -ForegroundColor Cyan

# ── Check git installed ──
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "❌ ไม่พบ git — กรุณาติดตั้งจาก https://git-scm.com" -ForegroundColor Red
    Start-Process "https://git-scm.com/download/win"
    pause; exit
}

# ── Create GitHub repo via API ──
$headers = @{
    "Authorization" = "token $GH_TOKEN"
    "Accept"        = "application/vnd.github.v3+json"
    "User-Agent"    = "CatPromptDeployer"
}
$body = @{
    name        = $REPO_NAME
    description = "Cat Infographic Prompt Generator PWA"
    homepage    = "https://$GH_USER.github.io/$REPO_NAME"
    private     = $false
    auto_init   = $false
} | ConvertTo-Json

try {
    $resp = Invoke-RestMethod -Uri "https://api.github.com/user/repos" `
        -Method POST -Headers $headers -Body $body -ContentType "application/json" -ErrorAction Stop
    Write-Host "✅ สร้าง repo สำเร็จ" -ForegroundColor Green
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 422) {
        Write-Host "⚠️  Repo นี้มีอยู่แล้ว — จะ push ทับไปเลย" -ForegroundColor Yellow
    } else {
        Write-Host "❌ สร้าง repo ไม่ได้ (HTTP $code)" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        pause; exit
    }
}

# ── Git init & push ──
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

git init -b main 2>$null
if ($LASTEXITCODE -ne 0) {
    git init 2>$null
    git checkout -b main 2>$null
}

git config user.email "deploy@cat-prompt-pwa.local"
git config user.name $GH_USER
git remote remove origin 2>$null
git remote add origin "https://${GH_TOKEN}@github.com/$GH_USER/$REPO_NAME.git"
git add .
git commit -m "🐾 Deploy Cat Prompt PWA" --allow-empty

git push -u origin main --force

if ($LASTEXITCODE -eq 0) {
    # Auto-enable GitHub Pages
    Start-Sleep -Seconds 2
    $pagesBody = '{"source":{"branch":"main","path":"/"}}'
    try {
        Invoke-RestMethod -Uri "https://api.github.com/repos/$GH_USER/$REPO_NAME/pages" `
            -Method POST -Headers $headers -Body $pagesBody -ContentType "application/json" -ErrorAction SilentlyContinue | Out-Null
    } catch {}

    Write-Host ""
    Write-Host "✅ ==========================================" -ForegroundColor Green
    Write-Host "   Deploy สำเร็จ! 🎉" -ForegroundColor Green
    Write-Host ""
    Write-Host "   🌐 GitHub repo:" -ForegroundColor Cyan
    Write-Host "   https://github.com/$GH_USER/$REPO_NAME" -ForegroundColor White
    Write-Host ""
    Write-Host "   ⏳ รอ 1-2 นาที แล้วเปิด iPhone Safari:" -ForegroundColor Cyan
    Write-Host "   https://$GH_USER.github.io/$REPO_NAME" -ForegroundColor White
    Write-Host ""
    Write-Host "   📱 บน iPhone Safari:" -ForegroundColor Cyan
    Write-Host "   กด Share → Add to Home Screen → เสร็จ!" -ForegroundColor White
    Write-Host "==========================================" -ForegroundColor Green

    # เปิด browser ไปที่ repo settings/pages
    Start-Sleep -Seconds 1
    Start-Process "https://github.com/$GH_USER/$REPO_NAME/settings/pages"
} else {
    Write-Host "❌ Push ไม่สำเร็จ — ตรวจสอบ token และ internet" -ForegroundColor Red
}

Write-Host ""
pause
