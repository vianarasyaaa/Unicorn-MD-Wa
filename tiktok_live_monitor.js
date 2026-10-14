import {
  ControlEvent,
  TikTokLiveConnection,
  WebcastEvent,
} from 'tiktok-live-connector'

const activeMonitors = new Map()
const presetKeywords = /\b(preset|alight\s*motion|alightmotion|xml)\b|drive\.google\.com|mediafire\.com/i
const maxPendingMessages = 500

function extractTikTokUsername(text) {
  const match = text.match(
    /tiktok\.com\/@([a-zA-Z0-9._]{2,24})(?=\/|[?#\s]|$)|@([a-zA-Z0-9._]{2,24})/i,
  )
  return (match?.[1] || match?.[2] || '').replace(/[.,!?]+$/, '')
}

export function parseTikTokLiveCommand(text) {
  const lower = text.trim().toLowerCase()
  const mentionsLive = /\b(live|siaran)\b/.test(lower)
  const mentionsMonitor = /\b(pantau|monitor|awasi)\b/.test(lower)

  if (!mentionsLive || !mentionsMonitor) return null

  if (/\b(stop|berhenti|hentikan|matikan)\b/.test(lower)) {
    return { command: 'stop' }
  }

  return {
    command: 'start',
    username: extractTikTokUsername(text),
    includeAll: /\b(semua|seluruh)\b/.test(lower),
  }
}

export async function stopTikTokLiveMonitor(jid) {
  const monitor = activeMonitors.get(jid)
  if (!monitor) return false

  activeMonitors.delete(jid)
  clearInterval(monitor.flushTimer)
  try {
    await monitor.connection.disconnect()
  } catch (error) {
    console.error(`Gagal menutup koneksi TikTok LIVE @${monitor.username}:`, error)
  }
  return true
}

export async function stopAllTikTokLiveMonitors() {
  await Promise.all([...activeMonitors.keys()].map((jid) => stopTikTokLiveMonitor(jid)))
}

export async function startTikTokLiveMonitor(socket, jid, username, includeAll = false) {
  if (!/^[a-zA-Z0-9._]{2,24}$/.test(username)) {
    throw new Error('Username TikTok tidak valid.')
  }

  await stopTikTokLiveMonitor(jid)

  const connection = new TikTokLiveConnection(username)
  const monitor = {
    connection,
    username,
    includeAll,
    pending: [],
    flushing: false,
    dropped: 0,
  }
  activeMonitors.set(jid, monitor)

  connection.on(WebcastEvent.CHAT, (data) => {
    if (activeMonitors.get(jid) !== monitor) return

    const comment = data.comment?.trim()
    if (!comment || (!includeAll && !presetKeywords.test(comment))) return

    const viewer = data.user?.nickname || data.user?.uniqueId || 'penonton'
    const line = `${viewer}: ${comment}`.slice(0, 700)
    if (monitor.pending.length >= maxPendingMessages) {
      monitor.pending.shift()
      monitor.dropped += 1
    }
    monitor.pending.push(line)
  })

  monitor.flushTimer = setInterval(async () => {
    if (monitor.flushing || monitor.pending.length === 0) return
    monitor.flushing = true

    const lines = []
    let length = 0
    while (monitor.pending.length && lines.length < 20) {
      const next = monitor.pending[0]
      if (length + next.length + 2 > 2_500 && lines.length > 0) break
      lines.push(monitor.pending.shift())
      length += next.length + 2
    }
    const dropped = monitor.dropped
    monitor.dropped = 0
    try {
      const overflowNotice = dropped ? `\n(${dropped} chat lama dilewati karena antrean penuh.)` : ''
      await socket.sendMessage(jid, {
        text: `💬 Chat LIVE @${username}\n${lines.map((line) => `• ${line}`).join('\n')}${overflowNotice}`,
      })
    } catch (error) {
      const unsent = [...lines, ...monitor.pending]
      const restored = unsent.slice(0, maxPendingMessages)
      monitor.pending = restored
      monitor.dropped += Math.max(0, unsent.length - restored.length)
      monitor.dropped += dropped
      console.error('Gagal meneruskan chat TikTok LIVE:', error)
    } finally {
      monitor.flushing = false
    }
  }, 5000)

  connection.on(ControlEvent.ERROR, (error) => {
    console.error(`TikTok LIVE @${username}:`, error)
  })

  connection.on(ControlEvent.DISCONNECTED, ({ code, reason } = {}) => {
    if (activeMonitors.get(jid) !== monitor) return

    activeMonitors.delete(jid)
    clearInterval(monitor.flushTimer)
    const detail = reason ? ` (${reason})` : ''
    socket
      .sendMessage(jid, {
        text: `Pantauan LIVE @${username} terputus${detail}. Kode: ${code ?? 'tidak diketahui'}.`,
      })
      .catch(console.error)
  })

  try {
    await connection.connect()
  } catch (error) {
    if (activeMonitors.get(jid) === monitor) activeMonitors.delete(jid)
    clearInterval(monitor.flushTimer)
    try {
      await connection.disconnect()
    } catch (disconnectError) {
      console.error(`Gagal menutup koneksi TikTok LIVE @${username}:`, disconnectError)
    }
    throw error
  }
}