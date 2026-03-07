#!/usr/bin/env node
/**
 * Listen on UDP port 2000 and print every message (OpenWind Python output).
 * Use when you want to see raw $WIMWV / $WIHDM without the plugin running.
 *
 *   node scripts/listen-udp-2000.js
 *
 * Or: nc -ul 2000   (if available)
 */
const dgram = require('dgram')
const PORT = 2000
const HOST = '127.0.0.1'

const sock = dgram.createSocket('udp4')
sock.on('message', (msg) => {
  const line = msg.toString().trim()
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`[${ts}] ${line}`)
})
sock.on('error', (err) => {
  console.error('UDP error:', err.message)
  process.exit(1)
})
sock.bind(PORT, HOST, () => {
  console.log(`Listening for OpenWind UDP on ${HOST}:${PORT} (Ctrl+C to stop)`)
})
