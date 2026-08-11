# JOB-002 AI + Telegram patch

This patch adds:
- NVIDIA NIM provider adapter
- automatic compatible text-model selection
- Telegram success/failure notifications
- persistent AI output in D1 ARTIFACTS
- job detail endpoint
- Bearer-token protection for all endpoints except `/health`

Required Cloudflare Worker secrets:
- `NVIDIA_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `FACTORY_ADMIN_TOKEN`

Do not commit secret values to GitHub.
