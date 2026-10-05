# Flutter Build Worker

Sistem ini menjalankan build APK Flutter lewat GitHub Actions, lalu Cloudflare Worker menjadi API untuk bot.

## Struktur

```text
flutter-build/
├── .github/
│   └── workflows/
│       └── build-flutter.yml
├── .env.example
├── .gitignore
├── README.md
├── package.json
├── worker.js
└── wrangler.toml
```

## Alur

1. Bot mengirim `POST /build` ke Cloudflare Worker.
2. Worker memanggil GitHub Actions `workflow_dispatch`.
3. GitHub Actions mengunduh ZIP source Flutter.
4. Actions menemukan `pubspec.yaml`, menjalankan `flutter pub get`, lalu `flutter build apk`.
5. APK disimpan sebagai GitHub Actions artifact selama 1 hari.
6. Bot mengecek `GET /status/:runId`.
7. Jika selesai sukses, bot mengunduh `GET /artifact/:runId`. Hasilnya adalah ZIP artifact GitHub yang berisi APK.

Worker tidak menahan request `/build` sampai build selesai. Itu memang sengaja karena build dapat memakan waktu puluhan menit.

## 1. GitHub token

Buat Fine-grained Personal Access Token yang hanya diberi akses ke repository `botspaceman85-bit/flutter-build`.

Permission repository yang diperlukan:

- Actions: Read and write

Jangan kirim token ke chat dan jangan masukkan token ke `worker.js` atau commit Git.

## 2. Deploy Cloudflare Worker

Di folder project:

```bash
npm install
npx wrangler login
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put WORKER_API_KEY
npx wrangler deploy
```

Saat `GITHUB_TOKEN` diminta, paste token GitHub.
Saat `WORKER_API_KEY` diminta, masukkan password API panjang dan acak. Contoh membuatnya di Linux/Termux:

```bash
openssl rand -hex 32
```

Setelah deploy, Wrangler akan memberikan URL seperti:

```text
https://flutter-build-worker.<subdomain>.workers.dev
```

## 3. Cek worker

```bash
curl https://flutter-build-worker.<subdomain>.workers.dev/health
```

Hasil yang benar:

```json
{
  "ok": true,
  "service": "flutter-build-worker"
}
```

## 4. Memulai build

Request:

```bash
curl -X POST "https://flutter-build-worker.<subdomain>.workers.dev/build" \
  -H "Authorization: Bearer YOUR_WORKER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "test-001",
    "userId": "123",
    "url": "https://github.com/OWNER/REPO/releases/download/VERSION/source.zip",
    "buildType": "release"
  }'
```

`url` harus URL HTTPS dari host GitHub yang diizinkan oleh `worker.js`.

Response normal:

```json
{
  "ok": true,
  "jobId": "test-001",
  "runId": 1234567890,
  "runUrl": "https://github.com/botspaceman85-bit/flutter-build/actions/runs/1234567890",
  "artifactName": "apk-test-001",
  "message": "Build queued"
}
```

## 5. Cek status

```bash
curl "https://flutter-build-worker.<subdomain>.workers.dev/status/1234567890" \
  -H "Authorization: Bearer YOUR_WORKER_API_KEY"
```

Saat masih jalan, `status` biasanya `queued` atau `in_progress`.
Saat selesai sukses:

```json
{
  "ok": true,
  "runId": 1234567890,
  "status": "completed",
  "conclusion": "success"
}
```

## 6. Download artifact

```bash
curl -L "https://flutter-build-worker.<subdomain>.workers.dev/artifact/1234567890" \
  -H "Authorization: Bearer YOUR_WORKER_API_KEY" \
  -o apk-1234567890.zip
```

ZIP tersebut berisi APK.

## Catatan penting

- File workflow harus tepat berada di `.github/workflows/build-flutter.yml`.
- Repository dan branch default pada konfigurasi ini adalah `botspaceman85-bit/flutter-build` dan `main`.
- Jangan commit `GITHUB_TOKEN` atau `WORKER_API_KEY`.
- APK artifact otomatis kedaluwarsa setelah 1 hari.
- Source ZIP harus berisi project Flutter dengan `pubspec.yaml`.
