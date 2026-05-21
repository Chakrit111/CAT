#!/bin/bash
# ============================================
# Cat Prompt PWA — Deploy to GitHub Pages
# ============================================
# วิธีใช้:
# 1. ติดตั้ง git ถ้ายังไม่มี
# 2. รัน: bash deploy.sh
# ============================================

echo ""
echo "🐾 Cat Prompt PWA — GitHub Pages Deployer"
echo "=========================================="
echo ""

# ── Step 1: GitHub username ──
read -p "👤 GitHub username ของคุณ: " GH_USER
if [ -z "$GH_USER" ]; then echo "❌ กรุณาใส่ username"; exit 1; fi

# ── Step 2: Repo name ──
read -p "📦 ชื่อ repo (default: cat-prompt-pwa): " REPO_NAME
REPO_NAME=${REPO_NAME:-cat-prompt-pwa}

# ── Step 3: Token ──
echo ""
echo "🔑 ต้องการ GitHub Personal Access Token"
echo "   วิธีสร้าง token:"
echo "   1. ไปที่ github.com → Settings → Developer settings"
echo "   2. Personal access tokens → Tokens (classic)"
echo "   3. Generate new token → เลือก 'repo' scope → Generate"
echo ""
read -s -p "🔑 วาง token ที่นี่ (จะไม่แสดงบนหน้าจอ): " GH_TOKEN
echo ""
if [ -z "$GH_TOKEN" ]; then echo "❌ กรุณาใส่ token"; exit 1; fi

echo ""
echo "⏳ กำลัง deploy..."

# ── Create repo via API ──
HTTP=$(curl -s -o /tmp/gh_resp.json -w "%{http_code}" \
  -X POST https://api.github.com/user/repos \
  -H "Authorization: token $GH_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  -d "{\"name\":\"$REPO_NAME\",\"description\":\"Cat Infographic Prompt Generator PWA\",\"homepage\":\"https://$GH_USER.github.io/$REPO_NAME\",\"private\":false,\"auto_init\":false}")

if [ "$HTTP" = "201" ]; then
  echo "✅ สร้าง repo สำเร็จ: github.com/$GH_USER/$REPO_NAME"
elif [ "$HTTP" = "422" ]; then
  echo "⚠️  Repo นี้มีอยู่แล้ว — จะ push ทับไปเลย"
else
  echo "❌ สร้าง repo ไม่ได้ (HTTP $HTTP)"
  cat /tmp/gh_resp.json
  exit 1
fi

# ── Git init & push ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$SCRIPT_DIR"
git init -b main 2>/dev/null || git checkout -b main 2>/dev/null || true
git config user.email "deploy@cat-prompt-pwa.local"
git config user.name "$GH_USER"

git remote remove origin 2>/dev/null || true
git remote add origin "https://$GH_TOKEN@github.com/$GH_USER/$REPO_NAME.git"

git add .
git commit -m "🐾 Deploy Cat Prompt PWA" --allow-empty

git push -u origin main --force

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ ============================================"
  echo "   Deploy สำเร็จ!"
  echo ""
  echo "   🌐 GitHub repo:"
  echo "   https://github.com/$GH_USER/$REPO_NAME"
  echo ""
  echo "   ⏳ เปิด GitHub Pages:"
  echo "   1. ไปที่ repo → Settings → Pages"
  echo "   2. Source: Deploy from branch → main → / (root)"
  echo "   3. กด Save"
  echo ""
  echo "   📱 URL สำหรับเปิดบน iPhone Safari:"
  echo "   https://$GH_USER.github.io/$REPO_NAME"
  echo "============================================"
else
  echo "❌ Push ไม่สำเร็จ — ตรวจสอบ token และ internet"
fi

# ── Auto-enable GitHub Pages ──
sleep 2
curl -s -X POST "https://api.github.com/repos/$GH_USER/$REPO_NAME/pages" \
  -H "Authorization: token $GH_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  -d '{"source":{"branch":"main","path":"/"}}' > /dev/null 2>&1
