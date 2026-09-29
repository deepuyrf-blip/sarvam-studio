Sarvam Pro Studio - Cloudflare Pages deployment
================================================

REPO STRUCTURE (yehi sabse zaroori hai):
  index.html                      <- fixed UI (honest health check)
  functions/api/[[path]].js       <- Pages Function (API proxy) - MUST be at this exact path
  README.txt

DEPLOY STEPS:
1. Cloudflare dashboard -> Workers & Pages -> Create -> Pages -> "Connect to Git"
   (Direct Upload se functions deploy NAHI hote - Git ya wrangler use karo)
2. Repo connect karo:
   - Framework preset: None
   - Build command: (khaali chhodo)
   - Build output directory: / (root)
3. Settings -> Variables and Secrets -> Add:
   Name: SARVAM_API_KEY    Type: Secret    Value: tumhari dashboard.sarvam.ai wali key
   (Production aur Preview dono environments me)
4. Deploy karo, phir browser me kholo:
   https://<project>.pages.dev/api/health
   -> JSON {"ok":true,"service":"sarvam-pages-function",...} dikhna chahiye.
   Agar HTML page dikhe to function deploy nahi hua - functions/ folder path check karo.

WRANGLER CLI SE DEPLOY (alternative):
   npx wrangler pages deploy . --project-name sarvam
   (repo root se chalao, jahan functions/ folder ho)
   Secret set karne ke liye:
   npx wrangler pages secret put SARVAM_API_KEY --project-name sarvam

VERIFY:
- Site pe "API Connected" (green) hona chahiye
- Text to Speech tab me generate karke audio aani chahiye

NOTE: API key kabhi index.html ya git me mat daalna - wo sirf
Cloudflare Pages Secret me rehti hai, server side inject hoti hai.
