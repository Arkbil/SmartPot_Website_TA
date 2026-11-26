# IoT Smart Pot — Render Web Service

Repository deployment khusus untuk dashboard IoT Smart Pot. Website memakai Supabase untuk autentikasi, kontrol LED, dan pembacaan telemetri.

## Jalankan lokal

```bash
npm start
```

Buka `http://localhost:3000`.

## Konfigurasi manual Render

| Pengaturan | Nilai |
|---|---|
| Service Type | Web Service |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/health` |

Tidak perlu environment variable untuk konfigurasi saat ini. Frontend menggunakan Supabase Publishable Key dan keamanannya dikendalikan oleh Row Level Security Supabase.
