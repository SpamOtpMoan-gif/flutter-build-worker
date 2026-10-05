# GitHub Flutter Build Worker

Worker ini dibuat agar cocok dengan `server.js` bot build yang melakukan:

1. membuat GitHub Release sementara;
2. upload ZIP source Flutter;
3. `workflow_dispatch` ke `build-flutter.yml`;
4. mengirim input `jobId`, `userId`, `payload`;
5. menunggu artifact bernama `apk-${jobId}`;
6. download artifact dari GitHub API.

## 1. Buat repository worker

Contoh:

    username/telegram-bot

Upload folder `.github/workflows/build-flutter.yml` ke repository tersebut.

Repository harus mengandung workflow ini pada branch default.

## 2. Aktifkan Actions

GitHub:
Settings -> Actions -> General

Pastikan Actions diizinkan berjalan.

## 3. Token GitHub

Bot membutuhkan token yang dapat:

- membaca repository;
- membuat/menghapus Release sementara;
- menjalankan workflow;
- membaca artifact dan status workflow.

Untuk fine-grained token, beri akses hanya ke repository worker dan berikan permission yang diperlukan untuk Contents dan Actions.

JANGAN masukkan token ke file workflow.

## 4. Daftarkan worker di bot

`githubworkers.json` di project bot harus berisi:

[
  {
    "id": "worker-1",
    "label": "worker1",
    "repo": "USERNAME/telegram-bot",
    "token": "GITHUB_TOKEN_DI_SERVER_BOT",
    "workflows": {
      "flutter": "build-flutter.yml",
      "android": "build-flutter.yml"
    },
    "enabled": true,
    "addedBy": 123456789,
    "addedAt": "2026-10-05T00:00:00.000Z"
  }
]

Lebih aman menggunakan command `/addworkergithub` yang sudah tersedia di bot bila implementasinya sudah aktif, daripada menyimpan token manual di file.

## 5. Kontrak input

Workflow menerima:

jobId
userId
payload

Contoh payload:

{
  "mode": "zip",
  "url": "https://...",
  "buildType": "release",
  "tag": "..."
}

`payload.url` adalah URL ZIP source yang dibuat oleh `server.js`.

## 6. Kontrak output

Artifact HARUS:

    apk-${jobId}

Di dalam artifact terdapat file:

    app-${jobId}.apk

`server.js` mencari artifact berdasarkan nama `apk-${jobId}`, jadi jangan ubah nama tersebut tanpa mengubah `server.js`.

## 7. Format ZIP Flutter

ZIP paling aman jika langsung berisi:

pubspec.yaml
lib/
android/
ios/
...

Kalau ZIP mempunyai satu folder pembungkus, workflow juga mencoba mencari `pubspec.yaml` sampai kedalaman 4 folder.

## 8. Build mode

`buildType`:

- `release` -> `flutter build apk --release`
- `debug` -> `flutter build apk --debug`
- `profile` -> `flutter build apk --profile`

## 9. Catatan penting

Workflow ini hanya membangun project Flutter yang sudah valid.

Jika project membutuhkan:

- private package;
- keystore signing;
- Firebase secret;
- `google-services.json`;
- environment variables;
- private Git repository;

maka secret/credential tersebut harus disediakan sebagai GitHub Actions Secrets/Variables dan workflow perlu disesuaikan.

Jangan upload credential ke ZIP source.

## 10. Keamanan

Token GitHub yang pernah dimasukkan ke `githubworkers.json` atau chat/log harus dianggap bocor.

Jika token pernah terekspos, revoke token tersebut dan buat token baru sebelum production.
