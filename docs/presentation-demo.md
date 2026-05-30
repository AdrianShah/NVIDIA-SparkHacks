# CivicVox-Omni — Presentation Demo Guide

Public access for judges on **web** and **phone** using Tailscale Funnel + Vercel + Expo tunnel.

---

## Architecture

```
Judge phone/browser
    │
    ├─ Web  → https://delatio.vercel.app  (Vercel)
    │              │
    │              └─ fetch / WebSocket ──► https://YOUR-MACHINE.ts.net  (Tailscale Funnel → GB10 :8080)
    │
    └─ Expo → Expo Go (QR via --tunnel)
                   │
                   └─ same Funnel URL via EXPO_PUBLIC_API_URL
```

---

## 1. Backend — Tailscale Funnel (Person 1 / GB10)

On the machine running FastAPI:

```bash
# Enable HTTPS certs once in Tailscale admin: https://login.tailscale.com/admin/dns
tailscale funnel 8080
```

Note the public URL, e.g. `https://gb10-demo.your-tailnet.ts.net`

Backend must listen on all interfaces:

```bash
uvicorn backend.server:app --host 0.0.0.0 --port 8080
```

Verify:

```bash
curl https://YOUR-MACHINE.ts.net/api/health
```

---

## 2. Web frontend — Vercel env vars

In [Vercel → nvidia-spark-hacks → Settings → Environment Variables](https://vercel.com) (Production):

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_API_URL` | `https://gx10-4b93.tail00f56a.ts.net` |
| `NEXT_PUBLIC_WS_URL` | `wss://gx10-4b93.tail00f56a.ts.net` |

Redeploy production (push to `main` or `npx vercel deploy --prod`).

Local dev: copy `frontend/.env.local.example` → `frontend/.env.local` with the same values.

**Web URL for judges:** https://delatio.vercel.app

---

## 3. Mobile — Expo app

```bash
cd mobile
npm install
cp .env.example .env
```

Edit `.env`:

```env
EXPO_PUBLIC_API_URL=https://gx10-4b93.tail00f56a.ts.net
EXPO_PUBLIC_WS_URL=wss://gx10-4b93.tail00f56a.ts.net
```

Start with **tunnel** so judges on any network can load the JS bundle via QR:

```bash
npm run start:demo
# equivalent: npx expo start --tunnel --clear
```

Scan the QR code with **Expo Go** (iOS/Android). Allow camera, mic, and location when prompted.

### Windows one-liner (from repo root)

```powershell
.\scripts\start-mobile-demo.ps1
```

---

## 4. What we configured in code

| Location | Config |
|----------|--------|
| `frontend/lib/api-config.ts` | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` (auto `wss` from `https`) |
| `frontend/app/page.tsx` | Imports config only — no hardcoded hosts |
| `mobile/config/api.ts` | `EXPO_PUBLIC_*` with correct `https` → `wss` derivation |
| `mobile/app.json` | `INTERNET` permission, `usesCleartextTraffic: false` (HTTPS only) |

If env vars are missing, both apps show an **API NOT CONFIGURED** screen instead of silently using localhost.

---

## 5. Pre-presentation checklist

- [ ] `tailscale funnel 8080` running on GB10
- [ ] `curl https://YOUR-MACHINE.ts.net/api/health` returns JSON
- [ ] Vercel Production env vars set to Funnel **https** / **wss** URLs
- [ ] Latest Vercel deploy is READY
- [ ] `mobile/.env` has matching Funnel URLs
- [ ] Test web from phone on **cellular** (not Tailscale): open delatio.vercel.app → START INCIDENT
- [ ] Test Expo: `npm run start:demo` → scan QR → START INCIDENT

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Mixed content blocked | Use `https://` API URL, not `http://100.x.x.x` |
| WebSocket fails | Use `wss://` not `ws://` on HTTPS sites |
| Expo QR won't load | Use `--tunnel`, not LAN mode |
| API NOT CONFIGURED screen | Set env vars and restart Expo / redeploy Vercel |
| CORS error | Backend allows `*` origins; check Funnel URL matches |
