# Unicorn-MD-Wa

Bot WhatsApp sederhana menggunakan `@whiskeysockets/baileys` versi `6.7.24` dan pairing code.

## Persiapan

- Node.js 20 atau lebih baru
- Python 3.10 atau lebih baru untuk scraping dan komentar TikTok
- Nomor WhatsApp aktif dengan kode negara

## Menjalankan

```sh
npm start
```

Saat pertama dijalankan, `npm start` otomatis memasang dependency Node.js dan Python yang belum ada. Setup membaca `package-lock.json` dan `requirements.txt`; saat restart berikutnya dependency yang tidak berubah dilewati. Pterodactyl perlu menyediakan Node.js 20+, Python 3.10+, pip, koneksi internet saat instalasi, serta izin menulis ke folder server.

Jalankan tes otomatis untuk parser pesan dan command:

```sh
npm test
.venv/bin/python -m unittest discover -s test -p '*_test.py'
```

Saat diminta, masukkan nomor dalam format internasional, angka saja. Contoh: `6281234567890`. Masukkan kode pairing yang tampil di terminal melalui WhatsApp pada **Perangkat tertaut > Tautkan dengan nomor telepon**.

Pterodactyl: upload source code beserta `package.json`, `package-lock.json`, `requirements.txt`, dan `install.sh`; jangan upload `node_modules/`, `.venv/`, atau cache Chromium. Gunakan startup command `npm start`. Setup otomatis membuat `.venv/` dan mengunduh paket yang diperlukan pada server. Dependency Python dibatasi ke parser Scrapling dan HTTPX; browser Chromium dan TikTokApi tidak diperlukan. Jika panel tidak menyediakan Python/pip, fitur scraping/komentar TikTok tidak akan bisa dipasang—proses setup akan menampilkan error yang jelas.

Kredensial WhatsApp tersimpan di folder `session/`; jangan bagikan atau commit folder tersebut.

## Menu, Knowledge, dan Game

Bot bisa dipakai tanpa prefix untuk permintaan yang dikenali, misalnya “menu”, “kamu bisa apa?”, “aku pengen main game”, atau “main tebak angka”. Menu menampilkan fitur yang benar-benar tersedia. Game lokal: tebak angka, kuis pilihan ganda, dan suit. Permainan berlangsung di chat yang memulainya dan bisa dihentikan dengan “batal”.

Balasan umum berasal dari knowledge lokal berbasis aturan, bukan AI. Bot tidak menjawab semua pertanyaan seperti model AI; untuk hal yang belum didukung, bot menjelaskan keterbatasannya. Fitur downloader, stiker, pemantau harga marketplace, serta pencarian/ekspor kontak bisnis belum diimplementasikan dan tidak ditampilkan sebagai fitur aktif.

Contoh:

```text
.scrape https://quotes.toscrape.com
```

Fungsi ini memakai Scrapling untuk merayapi link halaman publik dengan urutan lebar (breadth-first): mulai dari halaman awal sebagai lapisan 0, mengikuti link pada host yang sama sampai lapisan 10, dan berhenti setelah maksimal 100 halaman berhasil/gagal dicoba. Status dan progres dikirim sambil berjalan; hasil chat menampilkan ringkasan maksimal 8 halaman agar tidak melewati batas pesan WhatsApp. Jeda minimal 0,25 detik digunakan di antara permintaan. Link lintas host, port web nonstandar, alamat IP privat, kredensial di URL, dan skema selain HTTP/HTTPS ditolak. Halaman login, konten yang dirender hanya oleh JavaScript, dan aturan situs dapat membatasi hasil.

## Ambil Komentar Video TikTok

Kirim ID video atau tautan video standar (bukan tautan LIVE):

```text
.komentar https://www.tiktok.com/@username/video/1234567890123456789
```

Kamu bisa kirim tautan video dahulu, lalu tulis secara natural:

```text
tolong carikan preset AM
```

Bot menyimpan tautan video terakhir per chat sampai bot restart, membalas tanpa AI atau API key, lalu mengambil hingga 100 komentar dan mencari yang menyebut preset/Alight Motion/XML atau tautan Drive/MediaFire. Status “oke siap” diperbarui menjadi loading, progres retry, lalu hasil pada pesan WhatsApp yang sama; log proses juga dicetak di terminal. Bisa juga kirim permintaan dan tautan video dalam satu pesan.

Fitur ini membaca komentar publik melalui endpoint web TikTok yang tidak resmi. Bot mengambil maksimal 100 komentar, dan mencoba ulang maksimal lima kali dengan jeda 2, 4, 8, dan 16 detik jika permintaan gagal. Endpoint dapat berubah atau membatasi permintaan; jika itu terjadi, bot memberi tahu bahwa pengambilan gagal. Gunakan hanya pada video dan komentar yang memang boleh kamu akses.

## Pantau Chat TikTok LIVE

Kirim pesan ke bot WhatsApp dengan username host atau tautan LIVE:

```text
tolong pantau chat live ini @username
tolong pantau chat live ini https://www.tiktok.com/@username/live
```

Secara default, bot meneruskan chat yang relevan dengan preset/Alight Motion. Untuk meneruskan semua chat, gunakan:

```text
pantau semua chat live @username
```

Hentikan pantauan dengan `berhenti pantau live`. Pemantauan hanya bekerja saat akun tersebut sedang LIVE. Konektor TikTok ini tidak resmi, hanya membaca chat publik, dan dapat berubah jika protokol TikTok berubah.