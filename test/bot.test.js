import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getMessageText,
  findPresetComments,
  handleIncomingMessage,
  isPresetSearchRequest,
  parseCommandText,
  parseTikTokVideoId,
} from '../index.js'
import { parseTikTokLiveCommand } from '../tiktok_live_monitor.js'

test('reads text from standard and wrapped WhatsApp messages', () => {
  assert.equal(getMessageText({ message: { conversation: ' hello ' } }), 'hello')
  assert.equal(
    getMessageText({
      message: {
        ephemeralMessage: {
          message: { imageMessage: { caption: 'photo caption' } },
        },
      },
    }),
    'photo caption',
  )
  assert.equal(
    getMessageText({
      message: {
        viewOnceMessageV2: {
          message: { videoMessage: { caption: 'video caption' } },
        },
      },
    }),
    'video caption',
  )
  assert.equal(
    getMessageText({
      message: { documentMessage: { caption: 'document caption' } },
    }),
    'document caption',
  )
  assert.equal(
    getMessageText({
      message: {
        listResponseMessage: {
          singleSelectReply: { selectedRowId: 'selected-option' },
        },
      },
    }),
    'selected-option',
  )
  assert.equal(
    getMessageText({
      message: {
        templateMessage: {
          hydratedFourRowTemplate: {
            hydratedContentText: 'template selection',
          },
        },
      },
    }),
    'template selection',
  )
})

test('recognizes commands without treating every URL as a scrape request', () => {
  assert.deepEqual(parseCommandText('.ping'), { command: 'ping', targetUrl: '' })
  assert.deepEqual(parseCommandText('menu'), { command: 'menu', targetUrl: '' })
  assert.deepEqual(parseCommandText('.scrape https://example.com'), {
    command: 'scrape',
    targetUrl: 'https://example.com',
  })
  assert.deepEqual(parseCommandText('ambil teks https://example.com'), {
    command: 'scrape',
    targetUrl: 'https://example.com',
  })
  assert.deepEqual(parseCommandText('tolong scrape link https://example.com.'), {
    command: 'scrape',
    targetUrl: 'https://example.com',
  })
  assert.equal(parseCommandText('halo https://example.com'), null)
  assert.equal(parseCommandText('https://example.com'), null)
  assert.equal(parseCommandText('.pingpong'), null)
  assert.equal(parseCommandText('.hello scrape https://example.com'), null)
  assert.deepEqual(
    parseCommandText('.komentar https://www.tiktok.com/@akun/video/1234567890123456789'),
    {
      command: 'comments',
      targetUrl: 'https://www.tiktok.com/@akun/video/1234567890123456789',
    },
  )
  assert.deepEqual(parseCommandText('.komentar 1234567890123456789'), {
    command: 'comments',
    targetUrl: '1234567890123456789',
  })
  assert.deepEqual(
    parseCommandText('tolong carikan komentar di vt https://www.tiktok.com/@akun/video/1234567890123456789'),
    {
      command: 'comments',
      targetUrl: 'https://www.tiktok.com/@akun/video/1234567890123456789',
    },
  )
})

test('extracts TikTok video IDs and rejects unrelated or LIVE links', () => {
  assert.equal(parseTikTokVideoId('1234567890123456789'), '1234567890123456789')
  assert.equal(
    parseTikTokVideoId('https://www.tiktok.com/@akun/video/1234567890123456789?lang=id'),
    '1234567890123456789',
  )
  assert.throws(() => parseTikTokVideoId('https://example.com/video/1234567890123456789'))
  assert.throws(() => parseTikTokVideoId('https://www.tiktok.com/@akun/live'))
  assert.throws(() => parseTikTokVideoId('not a video'))
})

test('recognizes natural preset-search requests and filters relevant comments', () => {
  assert.equal(isPresetSearchRequest('tolong carikan preset AM'), true)
  assert.equal(isPresetSearchRequest('cari preset Alight Motion dong'), true)
  assert.equal(isPresetSearchRequest('tolong carikan video lucu'), false)
  assert.deepEqual(
    findPresetComments([
      'Halo semua',
      'Preset AM XML di sini',
      'https://drive.google.com/file/d/123',
      'Aku suka videonya',
    ]),
    ['Preset AM XML di sini', 'https://drive.google.com/file/d/123'],
  )
})

test('acknowledges a preset search and asks for a video when no link is known', async () => {
  const sent = []
  const socket = {
    async sendMessage(jid, content) {
      sent.push({ jid, content })
      return { key: { id: `mock-${sent.length}`, remoteJid: jid } }
    },
  }

  await handleIncomingMessage(socket, {
    key: { remoteJid: 'test@s.whatsapp.net', fromMe: false },
    message: { conversation: 'tolong carikan preset AM' },
  })

  assert.equal(sent.length, 1)
  assert.match(sent[0].content.text, /Okee siap bro/)
  assert.match(sent[0].content.text, /Kirim dulu link video TikTok/)
})

test('opens a readable feature menu with natural language', async () => {
  const sent = []
  const socket = {
    async sendMessage(jid, content) {
      sent.push({ jid, content })
      return { key: { id: `mock-${sent.length}`, remoteJid: jid } }
    },
  }

  await handleIncomingMessage(socket, {
    key: { remoteJid: 'menu-test@s.whatsapp.net', fromMe: false },
    message: { conversation: 'buka menu' },
  })

  assert.equal(sent.length, 1)
  assert.match(sent[0].content.text, /MENU BOT/)
  assert.match(sent[0].content.text, /TikTok/)
  assert.match(sent[0].content.text, /belum aktif/)
})

test('starts a game from a natural request, accepts a numbered choice, and can stop', async () => {
  const sent = []
  const socket = {
    async sendMessage(jid, content) {
      sent.push({ jid, content })
      return { key: { id: `mock-${sent.length}`, remoteJid: jid } }
    },
  }
  const jid = 'game-test@s.whatsapp.net'
  const sendText = (text) =>
    handleIncomingMessage(socket, {
      key: { remoteJid: jid, fromMe: false },
      message: { conversation: text },
    })

  await sendText('aku pengen main game')
  assert.match(sent.at(-1).content.text, /Tebak Angka/)
  assert.match(sent.at(-1).content.text, /Kuis Kilat/)

  await sendText('1')
  assert.match(sent.at(-1).content.text, /Tebak Angka/)
  assert.match(sent.at(-1).content.text, /1–20/)

  await sendText('25')
  assert.match(sent.at(-1).content.text, /angka bulat dari 1 sampai 20/)

  await sendText('batal')
  assert.match(sent.at(-1).content.text, /Permainan dihentikan/)
})

test('plays a game selected by name and answers using a local knowledge bank', async () => {
  const sent = []
  const socket = {
    async sendMessage(jid, content) {
      sent.push({ jid, content })
      return { key: { id: `mock-${sent.length}`, remoteJid: jid } }
    },
  }
  const jid = 'knowledge-test@s.whatsapp.net'
  const sendText = (text) =>
    handleIncomingMessage(socket, {
      key: { remoteJid: jid, fromMe: false },
      message: { conversation: text },
    })

  await sendText('main suit')
  assert.match(sent.at(-1).content.text, /Suit!/)
  await sendText('batu')
  assert.match(sent.at(-1).content.text, /Aku (juga )?pilih (batu|gunting|kertas)/)

  await sendText('Downloader Instagram bisa?')
  assert.match(sent.at(-1).content.text, /belum tersedia/)
  assert.doesNotMatch(sent.at(-1).content.text, /sedang mengunduh/i)

  await sendText('main kuis')
  assert.match(sent.at(-1).content.text, /Kuis Kilat/)
  await sendText('z')
  assert.match(sent.at(-1).content.text, /Pilih A, B, atau C/)
  await sendText('b')
  assert.match(sent.at(-1).content.text, /Betul|Belum tepat/)
})

test('recognizes TikTok LIVE start and stop commands', () => {
  assert.deepEqual(
    parseTikTokLiveCommand(
      'tolong pantau chat live ini https://www.tiktok.com/@username/live?lang=id',
    ),
    { command: 'start', username: 'username', includeAll: false },
  )
  assert.deepEqual(
    parseTikTokLiveCommand('pantau semua chat live @username'),
    { command: 'start', username: 'username', includeAll: true },
  )
  assert.deepEqual(
    parseTikTokLiveCommand('pantau live @username.'),
    { command: 'start', username: 'username', includeAll: false },
  )
  assert.deepEqual(parseTikTokLiveCommand('berhenti pantau live'), {
    command: 'stop',
  })
  assert.equal(parseTikTokLiveCommand('halo'), null)
})
