import makeWASocket, {
  DisconnectReason,
  extractMessageContent,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { dirname, resolve, join } from 'node:path'
import { existsSync } from 'node:fs'
import { stdin as input, stdout as output } from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  parseTikTokLiveCommand,
  startTikTokLiveMonitor,
  stopAllTikTokLiveMonitors,
  stopTikTokLiveMonitor,
} from './tiktok_live_monitor.js'
import { findKnowledgeAnswer } from './bot_knowledge.js'

const logger = pino({ level: 'silent' })
const prefix = '.'
const appDirectory = dirname(fileURLToPath(import.meta.url))
const localPython = join(
  appDirectory,
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
)
const pythonExecutable =
  process.env.PYTHON ||
  (existsSync(localPython)
    ? localPython
    : process.platform === 'win32'
      ? 'python'
      : 'python3')
let pairingNumber
let reconnectTimer
let currentSocket
let reconnectAttempts = 0
const recentVideoByChat = new Map()
const activeGameByChat = new Map()
const pendingGameMenuByChat = new Map()

const gameCatalog = [
  { id: 'number', name: 'Tebak Angka', description: 'Tebak angka rahasia 1–20.' },
  { id: 'quiz', name: 'Kuis Kilat', description: 'Jawab satu pertanyaan pilihan ganda.' },
  { id: 'rps', name: 'Suit', description: 'Batu, gunting, atau kertas melawan bot.' },
]

const quizQuestions = [
  {
    question: 'Planet terbesar di tata surya adalah apa?',
    options: ['A. Mars', 'B. Jupiter', 'C. Venus'],
    answer: 'b',
    explanation: 'Jupiter adalah planet terbesar di tata surya.',
  },
  {
    question: 'Berapa hasil 8 × 7?',
    options: ['A. 54', 'B. 56', 'C. 64'],
    answer: 'b',
    explanation: '8 × 7 = 56.',
  },
  {
    question: 'Hewan darat tercepat adalah apa?',
    options: ['A. Cheetah', 'B. Kuda', 'C. Singa'],
    answer: 'a',
    explanation: 'Cheetah adalah hewan darat tercepat.',
  },
]

async function askForPhoneNumber() {
  while (!pairingNumber) {
    const prompt = createInterface({ input, output })
    const answer = await prompt.question(
      'Masukkan nomor WhatsApp dengan kode negara (contoh 6281234567890): ',
    )
    prompt.close()

    const normalized = answer.replace(/\D/g, '')
    if (normalized.length >= 8 && normalized.length <= 15) {
      pairingNumber = normalized
    } else {
      console.log('Nomor tidak valid. Gunakan 8-15 digit, termasuk kode negara.')
    }
  }

  return pairingNumber
}

export function getMessageText(message) {
  const content = extractMessageContent(message.message)
  return (
    content?.conversation ??
    content?.extendedTextMessage?.text ??
    content?.imageMessage?.caption ??
    content?.videoMessage?.caption ??
    content?.documentMessage?.caption ??
    content?.buttonsResponseMessage?.selectedDisplayText ??
    content?.buttonsResponseMessage?.selectedButtonId ??
    content?.listResponseMessage?.singleSelectReply?.selectedRowId ??
    content?.listResponseMessage?.title ??
    content?.templateButtonReplyMessage?.selectedDisplayText ??
    content?.templateButtonReplyMessage?.selectedId ??
    content?.interactiveResponseMessage?.body?.text ??
    ''
  ).trim()
}

function extractUrlFromText(text) {
  const match = text.match(/https?:\/\/[^\s]+|www\.[^\s]+/i)
  return match ? match[0].replace(/[),.!?]+$/, '') : ''
}

export function parseCommandText(text) {
  const normalized = text.trim()
  if (!normalized) return null

  const prefixed = normalized.startsWith(prefix)
  const withoutPrefix = prefixed ? normalized.slice(prefix.length).trim() : normalized
  const lower = withoutPrefix.toLowerCase()

  if (/^ping(?:\s|$)/i.test(lower)) return { command: 'ping', targetUrl: '' }
  if (/^(menu|help|bantuan|perintah)(?:\s|$)/i.test(lower)) {
    return { command: 'menu', targetUrl: '' }
  }

  const isCommentsCommand = prefixed
    ? /^(komentar|comments?)(?:\s|$)/i.test(lower)
    : /\b(komentar|comments?)\b/i.test(lower) &&
      Boolean(extractUrlFromText(withoutPrefix) || withoutPrefix.match(/\b\d{10,30}\b/))
  if (isCommentsCommand) {
    const videoId = withoutPrefix.match(/\b\d{10,30}\b/)
    return {
      command: 'comments',
      targetUrl: extractUrlFromText(withoutPrefix) || videoId?.[0] || '',
    }
  }

  const hasScrapeIntent = prefixed
    ? /^(scrape|scraping|scrapling|screping|ambil|crawl)(?:\s|$)/i.test(lower)
    : /\b(scrape|scraping|scrapling|screping|ambil|crawl)\b/i.test(lower) ||
      /\btolong\b.*\b(link|url)\b/i.test(lower)
  if (hasScrapeIntent) {
    return { command: 'scrape', targetUrl: extractUrlFromText(withoutPrefix) }
  }

  return null
}

export function isPresetSearchRequest(text) {
  const lower = text.toLowerCase()
  const hasSearchIntent = /\b(carikan|cari|temukan|search|find)\b/i.test(lower)
  const hasPresetIntent = /\b(preset|alight\s*motion|alightmotion)\b/i.test(lower)
  return hasSearchIntent && hasPresetIntent
}

export function isMenuRequest(text) {
  return /\b(menu|daftar fitur|fitur bot|buka menu|lihat menu)\b/i.test(text)
}

export function isGameRequest(text) {
  return /\b(main game|pengen main|mau main|ingin main|ayo main|ajak main)\b/i.test(
    text,
  )
}

export function parseGameChoice(text) {
  const lower = text.toLowerCase()
  if (/\b(tebak angka|game angka|angka)\b/.test(lower)) return 'number'
  if (/\b(kuis|quiz|trivia)\b/.test(lower)) return 'quiz'
  if (/\b(suit|batu|gunting|kertas)\b/.test(lower)) return 'rps'
  return null
}

export function buildGameMenuText() {
  return [
    '*🎮 PILIH GAME*',
    '',
    ...gameCatalog.map(
      (game, index) => `${index + 1}. *${game.name}* — ${game.description}`,
    ),
    '',
    'Balas dengan nama game, misalnya “tebak angka”.',
  ].join('\n')
}

export function buildMainMenuText() {
  return [
    '*🤖 MENU BOT*',
    '',
    '*Umum*',
    '1. Menu — tampilkan daftar ini',
    '2. Ping — cek bot (atau kirim “ping”)',
    '3. Knowledge lokal — tanya “kamu bisa apa?”',
    '',
    '*Game*',
    '4. Bilang “aku pengen main game” untuk memilih game',
    '   • Tebak Angka • Kuis Kilat • Suit',
    '',
    '*TikTok*',
    '5. Kirim link video lalu bilang “carikan preset AM” (atau .komentar <link>)',
    '6. “pantau chat live @username” atau “berhenti pantau live”',
    '',
    '*Web*',
    '7. “ambil teks https://alamat-situs” untuk halaman publik (atau .scrape <url>)',
    '',
    'Fitur lain belum aktif? Tanyakan dulu—aku tidak akan berpura-pura menjalankannya.',
  ].join('\n')
}

export function findPresetComments(comments) {
  const presetPattern =
    /\b(preset|alight\s*motion|alightmotion|xml)\b|drive\.google\.com|mediafire\.com/i
  return comments.filter((comment) => presetPattern.test(comment))
}

export function parseTikTokVideoId(target) {
  const value = target.trim().replace(/[),.!?]+$/, '')
  if (/^\d{10,30}$/.test(value)) return value

  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Kirim ID video atau tautan video TikTok yang valid.')
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !(url.hostname === 'tiktok.com' || url.hostname.endsWith('.tiktok.com'))
  ) {
    throw new Error('Tautan harus berasal dari tiktok.com.')
  }

  const match = url.pathname.match(/\/video\/(\d{10,30})(?:\/|$)/)
  if (!match) {
    throw new Error('ID video tidak ditemukan. Gunakan tautan video TikTok, bukan tautan LIVE.')
  }

  return match[1]
}

function isCasualChat(text) {
  if (!text || text.length < 3) return false
  const lower = text.toLowerCase()
  return /\b(hai|halo|hallo|hey|siap|ngobrol|ngapain|gmn|gimana|santai|makasih|terima kasih|thanks|sayang|bucin|keren|mantap|bye|dadah)\b/i.test(
    lower,
  )
}

function startGame(gameId) {
  if (gameId === 'number') {
    const target = Math.floor(Math.random() * 20) + 1
    return {
      state: { id: 'number', target, attempts: 0 },
      text: '🎯 *Tebak Angka*\nAku menyimpan angka 1–20. Tebak angkanya dengan mengirim angka. Bilang “batal” untuk berhenti.',
    }
  }

  if (gameId === 'quiz') {
    const question = quizQuestions[Math.floor(Math.random() * quizQuestions.length)]
    return {
      state: { id: 'quiz', answer: question.answer, explanation: question.explanation },
      text: `🧠 *Kuis Kilat*\n${question.question}\n${question.options.join('\n')}\n\nBalas A, B, atau C. Bilang “batal” untuk berhenti.`,
    }
  }

  return {
    state: { id: 'rps' },
    text: '✊ *Suit!*\nKirim “batu”, “gunting”, atau “kertas”. Bilang “batal” untuk berhenti.',
  }
}

function playGameTurn(jid, text) {
  const game = activeGameByChat.get(jid)
  if (!game) return null

  const answer = text.trim().toLowerCase()
  if (/\b(batal|berhenti|stop|keluar)\b/i.test(answer)) {
    activeGameByChat.delete(jid)
    return 'Permainan dihentikan. Kalau mau main lagi, bilang “aku pengen main game”.'
  }

  if (game.id === 'number') {
    const guess = Number(answer)
    if (!Number.isInteger(guess) || guess < 1 || guess > 20) {
      return 'Kirim angka bulat dari 1 sampai 20 ya. Bilang “batal” kalau mau berhenti.'
    }
    game.attempts += 1
    if (guess === game.target) {
      activeGameByChat.delete(jid)
      return `🎉 Betul! Angkanya ${game.target}. Kamu berhasil dalam ${game.attempts} tebakan!`
    }
    return guess < game.target ? 'Masih kurang besar 👆 Coba lagi!' : 'Kebesaran 👇 Coba lagi!'
  }

  if (game.id === 'quiz') {
    const choice = answer.match(/^(?:jawaban\s*)?([abc])(?:[.)! ]|$)/)?.[1]
    if (!choice) return 'Pilih A, B, atau C ya. Bilang “batal” kalau mau berhenti.'
    activeGameByChat.delete(jid)
    return choice === game.answer
      ? `✅ Betul! ${game.explanation}`
      : `Belum tepat 😄 ${game.explanation}`
  }

  const choice = answer.match(/\b(batu|gunting|kertas)\b/)?.[1]
  if (!choice) return 'Kirim “batu”, “gunting”, atau “kertas” ya.'
  const botChoice = ['batu', 'gunting', 'kertas'][Math.floor(Math.random() * 3)]
  activeGameByChat.delete(jid)
  if (choice === botChoice) return `Aku juga pilih ${botChoice}. Seri! 🤝`
  const wins =
    (choice === 'batu' && botChoice === 'gunting') ||
    (choice === 'gunting' && botChoice === 'kertas') ||
    (choice === 'kertas' && botChoice === 'batu')
  return `Aku pilih ${botChoice}. ${wins ? 'Kamu menang! 🥳' : 'Kali ini aku menang 😎'}`
}

function buildNaturalReply(text) {
  const lower = text.toLowerCase()
  const knowledgeAnswer = findKnowledgeAnswer(text)
  if (knowledgeAnswer) return knowledgeAnswer
  if (/\b(ping|tes|test)\b/i.test(lower)) return 'Pong! 🏓 Bot aktif.'
  if (/\b(halo|hallo|hai|hey|hi|pagi|siang|sore|malam)\b/i.test(lower)) {
    return 'Hai! Aku bot berbasis knowledge lokal. Bilang “menu” untuk melihat fitur atau “aku pengen main game” untuk bermain. 😄'
  }
  if (/\b(ngapain|lagi apa|lagi ngapain|sedang apa)\b/i.test(lower)) {
    return 'Aku lagi standby. Mau lihat “menu”, tanya “kamu bisa apa?”, atau main game?'
  }
  if (/\b(makasih|terima kasih|thanks|thank you)\b/i.test(lower)) {
    return 'Sama-sama! Kalau perlu bantuan lain, tinggal bilang ya. 😊'
  }
  if (/\b(bye|dadah|sampai jumpa|pamit)\b/i.test(lower)) {
    return 'Dadah, sampai nanti! 👋'
  }
  return 'Aku belum punya jawaban untuk itu di knowledge lokal. Bilang “menu” untuk melihat yang bisa kulakukan. Aku tidak memakai AI/API key, jadi pengetahuanku terbatas.'
}

function runScrapling(url, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    console.log(`[Scrape] Mulai merayapi ${url} (maks. 10 lapisan/100 halaman).`)
    const child = spawn(
      pythonExecutable,
      [fileURLToPath(new URL('./scrapling_helper.py', import.meta.url)), url],
      {
        cwd: appDirectory,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    let pendingLog = ''
    let timedOut = false
    let outputTooLarge = false
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, 360_000)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (Buffer.byteLength(stdout, 'utf8') > 2_097_152) {
        outputTooLarge = true
        child.kill('SIGTERM')
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      pendingLog += chunk
      const lines = pendingLog.split(/\r?\n/)
      pendingLog = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        const progress = line.match(
          /^SCRAPE_PROGRESS (\d+)\/(\d+) (\d+) (.+)$/,
        )
        if (progress) {
          const completed = Number(progress[1])
          const total = Number(progress[2])
          const depth = Number(progress[3])
          console.log(
            `[Scrape] Halaman ${completed}/${total}, lapisan ${depth}: ${progress[4]}`,
          )
          if (completed === 1 || completed % 5 === 0 || completed === total) {
            onProgress({ completed, total, depth })
          }
        } else {
          console.log(`[Scrape] ${line.trim()}`)
        }
      }
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (pendingLog.trim()) console.log(`[Scrape] ${pendingLog.trim()}`)
      if (timedOut) {
        reject(new Error('Scraping melewati batas waktu enam menit.'))
        return
      }
      if (outputTooLarge) {
        reject(new Error('Hasil scraping terlalu besar; batasi jumlah halaman.'))
        return
      }
      if (!stdout.trim()) {
        reject(new Error(stderr.trim() || `Proses scraping berhenti dengan kode ${code}.`))
        return
      }

      try {
        resolve(JSON.parse(stdout))
      } catch (error) {
        reject(new Error(`Gagal membaca hasil Scrapling: ${error.message}`))
      }
    })
  })
}

function runTikTokComments(videoId, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    console.log(`[TikTok comments] Mulai mencari komentar video ${videoId}.`)
    const child = spawn(
      pythonExecutable,
      [fileURLToPath(new URL('./tiktok_comments_helper.py', import.meta.url)), videoId],
      {
        cwd: appDirectory,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    let pendingLog = ''
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, 240_000)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      pendingLog += chunk
      const lines = pendingLog.split(/\r?\n/)
      pendingLog = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        console.log(`[TikTok comments] ${line.trim()}`)
        const retry = line.match(/percobaan (\d+)\/(\d+).*dalam (\d+) detik/i)
        if (retry) {
          onProgress(
            `TikTok membatasi/menunda respons. Mencoba lagi (${retry[1]}/${retry[2]}) dalam ${retry[3]} detik…`,
          )
        }
      }
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (pendingLog.trim()) console.log(`[TikTok comments] ${pendingLog.trim()}`)
      if (timedOut) {
        reject(new Error('Pencarian melewati batas waktu 4 menit.'))
        return
      }
      if (!stdout.trim()) {
        reject(new Error(stderr.trim() || `Proses pengambil komentar berhenti dengan kode ${code}.`))
        return
      }

      try {
        const result = JSON.parse(stdout)
        console.log(
          `[TikTok comments] Selesai: ${result.comments?.length ?? 0} komentar, ${result.attempts ?? 0} percobaan.`,
        )
        resolve(result)
      } catch (error) {
        reject(new Error(`Gagal membaca hasil komentar TikTok: ${error.message}`))
      }
    })
  })
}

async function searchVideoComments(socket, jid, message, videoId, searchForPreset) {
  let statusMessage = await socket.sendMessage(
    jid,
    {
      text: searchForPreset
        ? 'Okee siap bro 😎 Aku cari preset AM di komentar videonya ya…'
        : 'Okee siap bro 😎 Aku lagi ambil komentar video TikTok…',
    },
    { quoted: message },
  )
  let updateQueue = Promise.resolve()
  const updateStatus = (text) => {
    updateQueue = updateQueue.catch(() => {}).then(async () => {
      try {
        statusMessage = await socket.sendMessage(jid, {
          text,
          edit: statusMessage.key,
        })
      } catch (error) {
        console.error('[TikTok comments] Gagal mengedit status WhatsApp:', error)
        statusMessage = await socket.sendMessage(jid, { text }, { quoted: message })
      }
    })
    return updateQueue
  }

  const loadingFrames = ['⏳', '⌛']
  let loadingIndex = 0
  const loadingTimer = setInterval(() => {
    loadingIndex = (loadingIndex + 1) % loadingFrames.length
    void updateStatus(
      `${loadingFrames[loadingIndex]} Sedang membaca komentar TikTok… ` +
        'Pencarian bisa mencoba ulang otomatis jika TikTok sedang sibuk.',
    ).catch((error) => {
      console.error('[TikTok comments] Gagal memperbarui status WhatsApp:', error)
    })
  }, 2_000)

  try {
    const result = await runTikTokComments(videoId, (progress) => {
      void updateStatus(`⏳ ${progress}`).catch((error) => {
        console.error('[TikTok comments] Gagal memperbarui status WhatsApp:', error)
      })
    })
    clearInterval(loadingTimer)

    if (result.status !== 'ok') {
      const failureSummary = result.attempts
        ? `Gagal mengambil komentar setelah ${result.attempts} percobaan.`
        : 'Fitur komentar belum siap.'
      await updateStatus(
        `Yah, belum berhasil 😕 ${failureSummary} ${result.message || 'TikTok tidak merespons.'}`,
      )
      return
    }

    const allComments = result.comments ?? []
    const comments = searchForPreset ? findPresetComments(allComments) : allComments
    const shownComments = comments.slice(0, 5)
    const body = shownComments.length
      ? shownComments.map((comment, index) => `${index + 1}. ${comment}`).join('\n\n')
      : searchForPreset
        ? `Aku sudah cek ${allComments.length} komentar, tapi belum menemukan komentar yang menyebut preset AM atau tautan preset.`
        : 'Belum ada komentar yang bisa diambil.'
    const heading = searchForPreset
      ? `Ketemu ${comments.length} komentar yang mungkin berisi preset AM`
      : `Berhasil ambil ${allComments.length} komentar`
    const more =
      comments.length > shownComments.length
        ? `\n\nMasih ada ${comments.length - shownComments.length} komentar lainnya.`
        : ''
    await updateStatus(`✅ ${heading}\n\n${body}${more}`.slice(0, 3500))
    console.log(
      `[TikTok comments] Selesai video ${videoId}: ${allComments.length} komentar diperiksa, ${comments.length} cocok dengan preset.`,
    )
  } catch (error) {
    clearInterval(loadingTimer)
    console.error(`[TikTok comments] Pencarian video ${videoId} gagal:`, error)
    await updateStatus(
      `Yah, pencarian komentar gagal 😕 ${error.message}. Periksa dependency Python dan coba lagi nanti.`,
    )
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session')
  const socket = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
  })
  currentSocket = socket

  socket.ev.on('creds.update', saveCreds)

  socket.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (currentSocket !== socket) return

    if (connection === 'open') {
      reconnectAttempts = 0
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
      console.log('Bot WhatsApp terhubung.')
      return
    }

    if (connection !== 'close') return

    const statusCode = lastDisconnect?.error?.output?.statusCode
    if (statusCode === DisconnectReason.loggedOut) {
      currentSocket = undefined
      await stopAllTikTokLiveMonitors()
      console.log('Sesi keluar. Hapus folder session lalu jalankan ulang untuk pairing.')
      return
    }

    currentSocket = undefined
    await stopAllTikTokLiveMonitors()
    if (reconnectTimer) return
    scheduleReconnect('Koneksi terputus.')
  })

  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' || currentSocket !== socket) return

    for (const message of messages) {
      try {
        await handleIncomingMessage(socket, message)
      } catch (error) {
        console.error('Gagal memproses pesan WhatsApp:', error)
      }
    }
  })

  if (!state.creds.registered) {
    const phoneNumber = await askForPhoneNumber()
    const code = await socket.requestPairingCode(phoneNumber)
    console.log(`Kode pairing: ${code}`)
    console.log('Buka WhatsApp > Perangkat tertaut > Tautkan dengan nomor telepon.')
  }
}

async function handleIncomingMessage(socket, message) {
  if (
    !message.message ||
    message.key.fromMe ||
    !message.key.remoteJid ||
    message.key.remoteJid === 'status@broadcast'
  ) {
    return
  }

  const text = getMessageText(message)
  const jid = message.key.remoteJid
  const messageUrl = extractUrlFromText(text)
  if (messageUrl && /tiktok\.com/i.test(messageUrl)) {
    try {
      recentVideoByChat.set(jid, parseTikTokVideoId(messageUrl))
    } catch {
      // Short links and LIVE URLs are not video IDs accepted by the comment endpoint.
    }
  }

  const liveCommand = parseTikTokLiveCommand(text)

  if (liveCommand?.command === 'stop') {
    const stopped = await stopTikTokLiveMonitor(jid)
    await socket.sendMessage(
      jid,
      {
        text: stopped
          ? 'Pantauan TikTok LIVE sudah dihentikan. ✅'
          : 'Belum ada LIVE yang sedang dipantau di chat ini.',
      },
      { quoted: message },
    )
    return
  }

  if (liveCommand?.command === 'start') {
    if (!liveCommand.username) {
      await socket.sendMessage(
        jid,
        {
          text: 'Kirim username atau link LIVE TikTok juga ya. Contoh: “tolong pantau chat live ini https://www.tiktok.com/@username/live”.',
        },
        { quoted: message },
      )
      return
    }

    try {
      await startTikTokLiveMonitor(
        socket,
        jid,
        liveCommand.username,
        liveCommand.includeAll,
      )
      await socket.sendMessage(
        jid,
        {
          text: liveCommand.includeAll
            ? `Siap, lagi pantau semua chat LIVE @${liveCommand.username}. Chat akan dikirim berkala ke sini. Untuk berhenti, bilang “berhenti pantau live”.`
            : `Siap, lagi pantau chat LIVE @${liveCommand.username}. Aku teruskan chat yang menyebut preset/Alight Motion atau tautan preset. Untuk semua chat, bilang “pantau semua chat live @${liveCommand.username}”. Untuk berhenti, bilang “berhenti pantau live”.`,
        },
        { quoted: message },
      )
    } catch (error) {
      await socket.sendMessage(
        jid,
        {
          text: `Gagal tersambung ke LIVE @${liveCommand.username}. Pastikan username benar dan akun sedang LIVE. Detail: ${error.message}`,
        },
        { quoted: message },
      )
    }
    return
  }

  const parsed = parseCommandText(text)
  if (isPresetSearchRequest(text)) {
    let videoId
    try {
      videoId = messageUrl ? parseTikTokVideoId(messageUrl) : recentVideoByChat.get(jid)
    } catch (error) {
      await socket.sendMessage(
        jid,
        {
          text: `Okee siap bro, tapi ${error.message}\nKirim tautan video TikTok yang ada /video/ID-nya, lalu minta “carikan preset AM”.`,
        },
        { quoted: message },
      )
      return
    }

    if (!videoId) {
      await socket.sendMessage(
        jid,
        {
          text: 'Okee siap bro 😎 Kirim dulu link video TikTok-nya, nanti aku cari komentar yang ada preset AM.',
        },
        { quoted: message },
      )
      return
    }

    await searchVideoComments(socket, jid, message, videoId, true)
    return
  }

  if (isMenuRequest(text)) {
    pendingGameMenuByChat.delete(jid)
    activeGameByChat.delete(jid)
    await socket.sendMessage(jid, { text: buildMainMenuText() }, { quoted: message })
    return
  }

  if (isGameRequest(text)) {
    activeGameByChat.delete(jid)
    pendingGameMenuByChat.set(jid, Date.now() + 120_000)
    await socket.sendMessage(jid, { text: buildGameMenuText() }, { quoted: message })
    return
  }

  let gameChoice = parseGameChoice(text)
  const pendingMenuExpiry = pendingGameMenuByChat.get(jid)
  if (pendingMenuExpiry && pendingMenuExpiry < Date.now()) {
    pendingGameMenuByChat.delete(jid)
  } else if (pendingMenuExpiry && /^[1-3]$/.test(text.trim())) {
    gameChoice = gameCatalog[Number(text.trim()) - 1].id
  }

  const hasStartIntent = /\b(main|mulai|ayo|pengen|mau|ingin|pilih)\b/i.test(text)
  if (gameChoice && (pendingGameMenuByChat.has(jid) || hasStartIntent)) {
    pendingGameMenuByChat.delete(jid)
    const game = startGame(gameChoice)
    activeGameByChat.set(jid, game.state)
    await socket.sendMessage(jid, { text: game.text }, { quoted: message })
    return
  }

  const knowledgeAnswer = findKnowledgeAnswer(text)
  if (!parsed && knowledgeAnswer) {
    await socket.sendMessage(jid, { text: buildNaturalReply(text) }, { quoted: message })
    return
  }

  const gameReply = parsed ? null : playGameTurn(jid, text)
  if (gameReply) {
    await socket.sendMessage(jid, { text: gameReply }, { quoted: message })
    return
  }

  if (!parsed && isCasualChat(text)) {
    await socket.sendMessage(jid, { text: buildNaturalReply(text) }, { quoted: message })
    return
  }

  if (!parsed) return

  const { command, targetUrl } = parsed

  if (command === 'ping') {
    await socket.sendMessage(jid, { text: 'Pong!' }, { quoted: message })
  } else if (command === 'menu') {
    await socket.sendMessage(jid, { text: buildMainMenuText() }, { quoted: message })
  } else if (command === 'comments') {
    let videoId
    try {
      videoId = parseTikTokVideoId(targetUrl)
    } catch (error) {
      await socket.sendMessage(
        jid,
        {
          text: `${error.message}\nContoh: .komentar https://www.tiktok.com/@akun/video/1234567890123456789`,
        },
        { quoted: message },
      )
      return
    }

    await searchVideoComments(socket, jid, message, videoId, false)
  } else if (command === 'scrape') {
    if (!targetUrl) {
      await socket.sendMessage(
        jid,
        { text: 'Format salah. Contoh: .scrape https://example.com atau "tolong scrape link ini https://example.com"' },
        { quoted: message },
      )
      return
    }

    let statusMessage = await socket.sendMessage(
      jid,
      {
        text: '🕸️ Mulai scraping maksimal 10 lapisan, domain yang sama, dan 100 halaman…',
      },
      { quoted: message },
    )
    let updateQueue = Promise.resolve()
    const updateStatus = (text) => {
      updateQueue = updateQueue.catch(() => {}).then(async () => {
        try {
          statusMessage = await socket.sendMessage(jid, {
            text,
            edit: statusMessage.key,
          })
        } catch (error) {
          console.error('[Scrape] Gagal mengedit status WhatsApp:', error)
          statusMessage = await socket.sendMessage(
            jid,
            { text },
            { quoted: message },
          )
        }
      })
      return updateQueue
    }

    try {
      const result = await runScrapling(targetUrl, ({ completed, total, depth }) => {
        void updateStatus(
          `🕸️ Sedang merayapi situs… ${completed}/${total} halaman, lapisan ${depth}/10.`,
        ).catch((error) => {
          console.error('[Scrape] Gagal memperbarui status WhatsApp:', error)
        })
      })
      await updateQueue

      if (result.status === 'error') {
        await updateStatus(
          `❌ Scrapling gagal\n${result.message || 'Terjadi kesalahan.'}`,
        )
        return
      }

      const pages = result.pages ?? []
      const pageSummary = pages
        .slice(0, 8)
        .map((page, index) => {
          const title = page.title ? `*${page.title}*` : page.url
          const excerpt = page.excerpt
            ? `\n${page.excerpt.slice(0, 220)}`
            : '\nTidak ada teks yang terbaca.'
          return `${index + 1}. [Lapisan ${page.depth}] ${title}${excerpt}`
        })
        .join('\n\n')
      const omittedPages = pages.length > 8
        ? `\n\n…dan ${pages.length - 8} halaman lain.`
        : ''
      const failures = result.failures?.length ?? 0
      const summary =
        `✅ Scraping selesai: ${result.pages_scanned} halaman berhasil, ` +
        `kedalaman ${result.max_depth_reached}/${result.max_depth}, batas ${result.max_pages} halaman.` +
        (failures ? ` ${failures} halaman gagal dibuka.` : '') +
        (result.truncated ? ' Batas jumlah halaman tercapai.' : '')
      await updateStatus(
        `${summary}\n\n${pageSummary || 'Tidak ada halaman yang berhasil dibaca.'}${omittedPages}`.slice(
          0,
          3500,
        ),
      )
    } catch (error) {
      await updateStatus(
        `❌ Scrapling gagal\n${error.message || 'Cek apakah Python dan Scrapling sudah terinstal.'}`,
      )
    }
  }
}

export { handleIncomingMessage }

function scheduleReconnect(reason) {
  if (reconnectTimer) return
  reconnectAttempts += 1
  const delay = Math.min(2_000 * 2 ** (reconnectAttempts - 1), 30_000)
  console.log(`${reason} Mencoba menyambungkan kembali dalam ${delay / 1000} detik...`)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined
    startBot().catch(async (error) => {
      console.error('Gagal membuat koneksi WhatsApp:', error)
      await stopAllTikTokLiveMonitors()
      scheduleReconnect('Inisialisasi koneksi gagal.')
    })
  }, delay)
}

function startBotIfMain() {
  if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    startBot().catch((error) => {
      console.error('Bot gagal dijalankan:', error)
      scheduleReconnect('Inisialisasi awal gagal.')
    })
  }
}

startBotIfMain()