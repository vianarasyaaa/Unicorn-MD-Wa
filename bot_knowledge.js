export const botKnowledge = [
  {
    id: 'identity',
    patterns: [/\b(siapa kamu|kamu siapa|nama kamu|tentang bot)\b/i],
    answer:
      'Aku bot WhatsApp berbasis aturan dan knowledge lokal, bukan AI. Aku bisa bantu melihat menu, bermain game, mengambil komentar video TikTok, memantau TikTok LIVE, dan membaca teks halaman web.',
  },
  {
    id: 'capabilities',
    patterns: [/\b(bisa apa|fitur apa|apa yang bisa kamu lakukan|fitur bot)\b/i],
    answer:
      'Yang sudah tersedia: menu dan ping, knowledge lokal, game tebak angka/kuis/suit, pencarian komentar video TikTok, pemantauan chat TikTok LIVE, dan ambil teks halaman web. Bilang “menu” untuk daftar lengkap.',
  },
  {
    id: 'no-ai',
    patterns: [/\b(pakai ai|pakai api key|tanpa ai|tanpa api key)\b/i],
    answer:
      'Betul, percakapan dan knowledge dasar memakai aturan lokal, jadi tidak perlu AI atau API key. Jawabanku terbatas pada fitur dan informasi yang sudah disimpan.',
  },
  {
    id: 'tiktok-comments',
    patterns: [/\b(komentar|preset|alight motion|alightmotion)\b/i],
    answer:
      'Untuk komentar video, kirim tautan video TikTok standar lalu bilang “carikan preset AM” atau “ambil komentar”. Tautan LIVE berbeda; untuk LIVE bilang “pantau chat live @username”.',
  },
  {
    id: 'scraping',
    patterns: [/\b(scrape|scraping|screping|website|web page|halaman web)\b/i],
    answer:
      'Aku bisa merayapi halaman publik sampai 10 lapisan dan maksimal 100 halaman, hanya pada domain yang sama. Kirim “ambil teks https://alamat-situs”. Harga marketplace atau halaman login belum tentu bisa dibaca.',
  },
  {
    id: 'privacy',
    patterns: [/\b(data pribadi|privasi|aman|password|kata sandi)\b/i],
    answer:
      'Jangan kirim password, kode verifikasi, cookie, atau token rahasia ke chat. Sesi WhatsApp bot disimpan di folder session/ pada server tempat bot berjalan.',
  },
  {
    id: 'business-leads',
    patterns: [/\b(kontak bisnis|prospek|lead bisnis|cari pelanggan)\b/i],
    answer:
      'Pencarian kontak bisnis dan ekspor Excel belum tersedia. Bot belum mengumpulkan atau mengirim data kontak otomatis. Fitur seperti itu sebaiknya memakai sumber publik yang diizinkan dan menyimpan hanya data bisnis yang relevan.',
  },
  {
    id: 'downloads',
    patterns: [/\b(download|unduh|unduhan|instagram|ig|tiktok)\b/i],
    answer:
      'Downloader video TikTok/Instagram belum tersedia. Fitur yang benar-benar aktif ada di menu; aku tidak akan mengaku mengunduh sebelum ada konektor yang dipasang.',
  },
  {
    id: 'price-monitoring',
    patterns: [/\b(harga|shopee|tokopedia|pantau harga|cek harga)\b/i],
    answer:
      'Pemantauan harga Shopee/Tokopedia belum tersedia. Scraper saat ini hanya mengambil teks umum dari halaman publik dan tidak menjamin bisa membaca harga produk atau halaman yang perlu login.',
  },
  {
    id: 'stickers',
    patterns: [/\b(stiker|sticker|buat stiker)\b/i],
    answer:
      'Fitur pembuatan stiker belum tersedia. Kamu bisa memakai menu untuk melihat fitur yang aktif sekarang.',
  },
  {
    id: 'spreadsheets',
    patterns: [/\b(excel|spreadsheet|xlsx|file data)\b/i],
    answer:
      'Ekspor ke Excel belum tersedia di tahap ini. Bot belum membuat atau mengirim file spreadsheet.',
  },
  {
    id: 'hosting',
    patterns: [/\b(pterodactyl|panel|hosting|server bot)\b/i],
    answer:
      'Bot bisa dijalankan di panel yang menyediakan Node.js 20+ dan Python 3.10+. Pastikan folder session/ persisten supaya koneksi WhatsApp tidak hilang saat server restart.',
  },
]

export function findKnowledgeAnswer(text) {
  return botKnowledge.find((entry) =>
    entry.patterns.some((pattern) => pattern.test(text)),
  )?.answer
}
