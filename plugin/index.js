module.exports = function(app) {
  /**
   * Broadcast-only (BLE advertisements, no GATT) is the default.
   * Prefer openWindBroadcastOnly; fall back to legacy useBleAdvertisements.
   */
  function openWindBroadcastOnlyEnabled(options) {
    if (typeof options.openWindBroadcastOnly === 'boolean') {
      return options.openWindBroadcastOnly
    }
    if (typeof options.useBleAdvertisements === 'boolean') {
      return options.useBleAdvertisements
    }
    return true
  }

  let timer
  let t = 0
  let latestHeading = 0
  let sensorYaw = 0
  let sensorWindAngle = 0
  let yawOffset = 0
  
  // OpenWind real sensor data
  let realAWA = null
  let realAWS = null
  let sensorYAW = null
  
  let apparentAngle = 180 * Math.PI / 180 // 180 degrees in radians
  
  // Python process for OpenWind
  let pythonProcess = null
  let depInstallProcess = null
  let restartPlugin = null
  let reportedBleAddress = ''
  let bleStatus = 'disconnected'
  let lastDataTime = 0
  let bleDisconnectTimer = null
  let udpSocket = null
  const BLE_GRACE_PERIOD_MS = 5000
  const pluginVersion = require('../package.json').version

  // Stuck-yaw detection: some OpenWind units intermittently broadcast a yaw
  // word of 0x0000 which decodes to exactly 270.0°. After enough consecutive
  // 270.0° frames we ignore sensor yaw and treat the mast as aligned with
  // the boat (mastRotation = yawOffset, typically 0) while still publishing
  // everything else as normal.
  const YAW_STUCK_DEG = 270
  let yaw270Streak = 0
  let yawStuck = false
  let yawStuckThresholdFrames = 10

  // Session logging for CSV download
  let logPath = null // set in start() when enableLogging; used by POST /open-wind/log/clear

  function setBleStatus(status) {
    if (status === 'connected') {
      if (bleDisconnectTimer) { clearTimeout(bleDisconnectTimer); bleDisconnectTimer = null }
      bleStatus = 'connected'
    } else if (status === 'disconnected' || status === 'not_found') {
      if (bleStatus === 'connected' && !bleDisconnectTimer) {
        bleDisconnectTimer = setTimeout(() => {
          bleDisconnectTimer = null
          bleStatus = status
          pluginLog('BLE status → ' + status + ' (grace period expired)')
        }, BLE_GRACE_PERIOD_MS)
      } else if (bleStatus !== 'connected') {
        bleStatus = status
      }
    } else {
      bleStatus = status
    }
  }

  const LOG_MAX = 50
  const logBuffer = []
  let logStream = null
  function pluginLog(msg) {
    const ts = new Date().toISOString().slice(11, 19)
    const line = `${ts} ${msg}`
    logBuffer.push(line)
    if (logBuffer.length > LOG_MAX) logBuffer.shift()
    if (logStream) {
      try {
        logStream.write(line + '\n')
      } catch (e) { /* ignore */ }
    }
  }

  /** NMEA 0183 XOR checksum for the substring starting after `$` up to but not including `*`. */
  function nmea0183Checksum(sentenceDollarNoStar) {
    let c = 0
    for (let i = 1; i < sentenceDollarNoStar.length; i++) {
      c ^= sentenceDollarNoStar.charCodeAt(i)
    }
    return ('0' + (c & 0xff).toString(16)).slice(-2).toUpperCase()
  }

  /**
   * @param {'none'|'rudder_rsa'|'heel_roll_xdr'} mode
   * @param {number} degSigned mast rotation in degrees
   * @returns {string|null} full sentence including CRLF, or null if disabled
   */
  function formatMastRotationNmea(mode, degSigned) {
    if (mode !== 'rudder_rsa' && mode !== 'heel_roll_xdr') return null
    const d = Number.isFinite(degSigned) ? degSigned : 0
    const degStr = d.toFixed(1)
    let body
    if (mode === 'rudder_rsa') {
      body = 'WIRSA,' + degStr + ',A,,V'
    } else {
      body = 'WIXDR,A,' + degStr + ',D,ROLL'
    }
    const dollarBody = '$' + body
    return dollarBody + '*' + nmea0183Checksum(dollarBody) + '\r\n'
  }
  
  async function checkSignalKRemote(host, port = 3000, timeout = 5000) {
    const http = require('http')
    const https = require('https')
    
    return new Promise((resolve) => {
      const protocol = port === 443 ? https : http
      
      const options = {
        hostname: host,
        port: port,
        path: '/signalk/v1/api/',
        method: 'GET',
        timeout: timeout
      }
      
      const req = protocol.request(options, (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            const json = JSON.parse(data)
            resolve({
              running: true,
              version: json.version || 'unknown',
              statusCode: res.statusCode,
              host: host,
              port: port
            })
          } catch (e) {
            resolve({
              running: res.statusCode < 500,
              statusCode: res.statusCode,
              host: host,
              port: port,
              error: 'Invalid JSON response'
            })
          }
        })
      })
      
      req.on('error', (err) => {
        resolve({
          running: false,
          host: host,
          port: port,
          error: err.message
        })
      })
      
      req.on('timeout', () => {
        req.destroy()
        resolve({
          running: false,
          host: host,
          port: port,
          error: 'Connection timeout'
        })
      })
      
      req.end()
    })
  }

  return {
    "id": "open-wind",
    "name": "Open Wind Plugin",
    "description": "OpenWind mast sensor → Signal K (mast rotation & heading). Hardware: https://www.openwind.de",
    "version": pluginVersion,
    "webapp": "public",
    start: function(options, restart) {
      restartPlugin = typeof restart === 'function' ? restart : null
      const path = require('path')
      const amplitude = options.amplitude || 10
      const interval = options.interval || 1000
      // Convert degrees to radians for yaw offset
      yawOffset = (options.yawOffset || 0) * Math.PI / 180
      // Wind angle calibration offset (degrees): add to AWA so display matches reality when mast is straight
      const windAngleOffsetDeg = typeof options.windAngleOffset === 'number' ? options.windAngleOffset : 0
      const windAngleOffsetRad = windAngleOffsetDeg * Math.PI / 180

      // Threshold of consecutive 270.0° yaw frames after which we treat the
      // sensor yaw as stuck and override it to boat heading.
      yaw270Streak = 0
      yawStuck = false
      yawStuckThresholdFrames = 10
      if (Number.isFinite(options.yawStuckFrames) && options.yawStuckFrames >= 1) {
        yawStuckThresholdFrames = Math.floor(options.yawStuckFrames)
      }
      pluginLog('Yaw stuck-at-270° threshold: ' + yawStuckThresholdFrames + ' frames')

      // Optional file log (when Enable logging is on)
      logPath = null
      if (options.enableLogging) {
        try {
          const os = require('os')
          const fs = require('fs')
          logPath = path.join(os.homedir(), '.signalk', 'open-wind-plugin.log')
          logStream = fs.createWriteStream(logPath, { flags: 'a' })
          logStream.on('error', () => { logStream = null })
          pluginLog('Logging to ' + logPath)
        } catch (e) {
          pluginLog('Could not open log file: ' + e.message)
        }
      }

      // Register webapp routes
      const indexPath = path.join(__dirname, '..', 'public', 'index.html')
      
      app.get('/open-wind', (req, res) => {
        res.sendFile(indexPath, (err) => {
          if (err) {
            console.error('Error serving index.html:', err)
            res.status(500).send('Error loading webapp')
          }
        })
      })
      
      app.get('/open-wind/', (req, res) => {
        res.sendFile(indexPath, (err) => {
          if (err) {
            console.error('Error serving index.html:', err)
            res.status(500).send('Error loading webapp')
          }
        })
      })
      
      // API endpoint to check if SignalK is running on a remote server
      app.get('/open-wind/check-signalk', async (req, res) => {
        const host = req.query.host || 'localhost'
        const port = parseInt(req.query.port) || 3000
        const timeout = parseInt(req.query.timeout) || 5000
        
        try {
          const result = await checkSignalKRemote(host, port, timeout)
          res.json(result)
        } catch (error) {
          res.status(500).json({
            running: false,
            host: host,
            port: port,
            error: error.message
          })
        }
      })
      
      // API endpoint to check local SignalK server status
      app.get('/open-wind/check-local-signalk', (req, res) => {
        try {
          const selfId = app.selfId || 'unknown'
          const version = app.version || 'unknown'
          
          res.json({
            running: true,
            version: version,
            selfId: selfId,
            host: 'localhost',
            message: 'SignalK server is running (plugin is active)'
          })
        } catch (error) {
          res.status(500).json({
            running: false,
            error: error.message
          })
        }
      })
      
      app.get('/open-wind/log', (req, res) => {
        const n = Math.min(parseInt(req.query.n) || 3, LOG_MAX)
        res.json(logBuffer.slice(-n))
      })

      // Session logging state (for CSV download)
      const sessionRows = []
      const sessionBufferSize = Math.max(1, parseInt(options.sessionBufferSize, 10) || 86400)
      const activityWindowMs = Math.max(1000, parseInt(options.sessionActivityWindowMs, 10) || 3600000)
      const POSITION_CHANGE_DEG = 0.00005   // ~5 m
      const HEADING_CHANGE_RAD = 2 * Math.PI / 180  // 2 degrees
      let lastActivityTime = 0
      let lastSessionLat = null
      let lastSessionLon = null
      let lastSessionHeading = null
      let forceRecording = false

      app.get('/open-wind/session/csv', (req, res) => {
        const fromParam = req.query.from
        const toParam = req.query.to
        let rows = sessionRows
        if (fromParam && toParam) {
          const fromMs = new Date(fromParam).getTime()
          const toMs = new Date(toParam).getTime()
          if (!isNaN(fromMs) && !isNaN(toMs)) {
            rows = sessionRows.filter(r => {
              const ms = new Date(r.timestamp).getTime()
              return ms >= fromMs && ms <= toMs
            })
          }
        }
        const header = 'timestamp,latitude,longitude,apparent_wind_speed_kts,apparent_wind_angle_deg,apparent_wind_direction_deg,true_wind_speed_kts,true_wind_angle_deg,mast_rotation_deg,boat_heading_deg'
        if (rows.length === 0) {
          res.set('Content-Type', 'text/csv')
          res.status(200).send(header + '\n')
          return
        }
        const csvLines = [header]
        for (const r of rows) {
          const lat = r.latitude != null ? Number(r.latitude).toFixed(4) : ''
          const lon = r.longitude != null ? Number(r.longitude).toFixed(4) : ''
          const aws = (r.awsKts !== '' && r.awsKts != null) ? Number(r.awsKts).toFixed(2) : ''
          const awa = (r.awaDeg !== '' && r.awaDeg != null) ? Number(r.awaDeg).toFixed(2) : ''
          const awd = (r.awdDeg !== '' && r.awdDeg != null) ? Number(r.awdDeg).toFixed(2) : ''
          const tws = r.twsKts !== '' && r.twsKts != null ? Number(r.twsKts).toFixed(2) : ''
          const twa = r.twaDeg !== '' && r.twaDeg != null ? Number(r.twaDeg).toFixed(2) : ''
          const mast = Number(r.mastRotationDeg).toFixed(2)
          const hdg = Number(r.headingDeg).toFixed(2)
          csvLines.push([r.timestamp, lat, lon, aws, awa, awd, tws, twa, mast, hdg].join(','))
        }
        const filename = 'open-wind-session-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.csv'
        res.set('Content-Type', 'text/csv')
        res.set('Content-Disposition', 'attachment; filename="' + filename + '"')
        res.status(200).send(csvLines.join('\n'))
      })

      app.get('/open-wind/session/count', (req, res) => {
        res.status(200).json({ count: sessionRows.length })
      })

      app.post('/open-wind/session/clear', (req, res) => {
        sessionRows.length = 0
        res.status(200).json({ cleared: true })
      })

      app.get('/open-wind/session/force-recording', (req, res) => {
        res.status(200).json({ enabled: forceRecording })
      })

      app.put('/open-wind/session/force-recording', (req, res) => {
        let enabled = forceRecording
        if (req.query.enabled !== undefined) {
          enabled = req.query.enabled === 'true' || req.query.enabled === '1'
        } else if (req.body && typeof req.body.enabled === 'boolean') {
          enabled = req.body.enabled
        } else if (req.body && typeof req.body.enabled === 'string') {
          enabled = req.body.enabled === 'true' || req.body.enabled === '1'
        }
        forceRecording = enabled
        res.status(200).json({ enabled: forceRecording })
      })

      app.post('/open-wind/log/clear', (req, res) => {
        const fs = require('fs')
        if (!logPath) {
          res.status(200).json({ cleared: false, message: 'No log file path' })
          return
        }
        try {
          if (logStream) {
            try { logStream.end() } catch (e) { /* ignore */ }
            logStream = null
          }
          if (fs.existsSync(logPath)) {
            fs.writeFileSync(logPath, '')
          }
          if (options.enableLogging) {
            logStream = fs.createWriteStream(logPath, { flags: 'a' })
            logStream.on('error', () => { logStream = null })
          }
          res.status(200).json({ cleared: true })
        } catch (e) {
          res.status(500).json({ cleared: false, error: e.message })
        }
      })

      function readOpenWindPluginOptions() {
        try {
          return app.readPluginOptions() || {}
        } catch (e) {
          return {}
        }
      }

      app.get('/open-wind/settings/ble', (req, res) => {
        const id = typeof options.openWindBleDeviceId === 'string' ? options.openWindBleDeviceId.trim() : ''
        res.json({
          openWindBleDeviceId: id,
          reportedBleAddress: reportedBleAddress
        })
      })

      app.put('/open-wind/settings/ble', (req, res) => {
        let raw = ''
        req.on('data', (chunk) => { raw += chunk })
        req.on('end', () => {
          let json = {}
          if (raw) {
            try {
              json = JSON.parse(raw)
            } catch (e) {
              res.status(400).json({ ok: false, error: 'Invalid JSON body' })
              return
            }
          }
          const id = typeof json.openWindBleDeviceId === 'string' ? json.openWindBleDeviceId.trim() : ''
          const stored = readOpenWindPluginOptions()
          const merged = {
            ...stored,
            configuration: {
              ...(stored.configuration || {}),
              openWindBleDeviceId: id
            }
          }
          app.savePluginOptions(merged, (err) => {
            if (err) {
              res.status(500).json({ ok: false, error: err.message })
              return
            }
            pluginLog('Saved openWindBleDeviceId; reloading plugin')
            res.json({ ok: true })
            const cfg = merged.configuration || merged
            setImmediate(() => {
              if (restartPlugin) {
                try {
                  restartPlugin(cfg)
                } catch (e) {
                  pluginLog('restartPlugin failed: ' + e.message)
                }
              }
            })
          })
        })
        req.on('error', (e) => {
          res.status(500).json({ ok: false, error: e.message })
        })
      })

      // UDP listener for OpenWind data
      const dgram = require('dgram')
      udpSocket = dgram.createSocket('udp4')
      
      udpSocket.on('message', (msg, rinfo) => {
        const nmeaSentence = msg.toString().trim()
        if (options.enableDebug && nmeaSentence) {
          pluginLog('UDP: ' + nmeaSentence)
        }
        if (nmeaSentence.startsWith('$')) {
          lastDataTime = Date.now()
          setBleStatus('connected')
        }
        
        // Parse NMEA sentences
        if (nmeaSentence.startsWith('$WIMWV')) {
          // Wind data: $WIMWV,angle,R,speed,N,A*checksum
          const parts = nmeaSentence.split(',')
          if (parts.length >= 4) {
            realAWA = parseFloat(parts[1]) * Math.PI / 180  // Convert to radians
            realAWS = parseFloat(parts[3]) * 0.514444  // Convert knots to m/s
            pluginLog('Wind AWA=' + (realAWA * 180 / Math.PI).toFixed(1) + '° AWS=' + (realAWS / 0.514444).toFixed(1) + 'kts')
          }
        } else if (nmeaSentence.startsWith('$WIHDM')) {
          // Heading data: $WIHDM,heading,M*checksum
          const parts = nmeaSentence.split(',')
          if (parts.length >= 2) {
            const yawDeg = parseFloat(parts[1])
            sensorYAW = yawDeg * Math.PI / 180  // Convert to radians
            pluginLog('Yaw=' + yawDeg.toFixed(1) + '°')

            // Exactly 270.0° is the decode of the sensor's stuck 0x0000 raw
            // word; any other value (jittery or not) is trusted.
            if (Number.isFinite(yawDeg) && yawDeg === YAW_STUCK_DEG) {
              yaw270Streak++
              if (yaw270Streak === yawStuckThresholdFrames) {
                yawStuck = true
                pluginLog('OpenWind yaw stuck at ' + YAW_STUCK_DEG + '° for '
                  + yaw270Streak + ' frames (threshold ' + yawStuckThresholdFrames
                  + '); ignoring sensor yaw until a different reading arrives '
                  + '(treating mast rotation as 0)')
              }
            } else {
              if (yawStuck) {
                pluginLog('OpenWind yaw recovered: ' + yawDeg.toFixed(1) + '°')
              }
              yaw270Streak = 0
              yawStuck = false
            }
          }
        }
      })
      
      udpSocket.on('error', (err) => {
        pluginLog('UDP socket error: ' + err.message)
        app.error('OpenWind UDP error: ' + err.message)
      })
      
      udpSocket.bind(2000, '127.0.0.1', () => {
        pluginLog('UDP listener started on port 2000')
      })
      
      // Spawn Python process for OpenWind
      const { spawn, execSync, exec } = require('child_process')
      const pythonScript = path.join(__dirname, 'OpenWind.py')
      const pluginDir = path.join(__dirname, '..')

      function startPythonProcess(pythonBin) {
        const args = ['-u', pythonScript]
        if (options.forceSimulation) {
          args.push('--simulate')
          pluginLog('Starting Python process (simulation mode): ' + pythonBin)
        } else {
          const reconnectDelay = (options.reconnectDelay != null) ? options.reconnectDelay : 15
          args.push('--reconnect-delay', String(reconnectDelay))
          if (openWindBroadcastOnlyEnabled(options)) {
            args.push('--ble-advertisements', '--broadcast-only')
            pluginLog('Starting Python process (BLE broadcast-only, no GATT): ' + pythonBin)
          } else {
            args.push('--ble-gatt')
            pluginLog('Starting Python process (legacy BLE GATT connection): ' + pythonBin)
          }
          const bleId = typeof options.openWindBleDeviceId === 'string' ? options.openWindBleDeviceId.trim() : ''
          if (bleId) {
            args.push('--ble-device-id', bleId)
            pluginLog('OpenWind BLE device id filter: ' + bleId)
          }
        }
        pythonProcess = spawn(pythonBin, args, {
          stdio: ['pipe', 'pipe', 'pipe']
        })

        pythonProcess.stdout.on('data', (data) => {
          data.toString().split('\n').forEach(line => {
            line = line.trim()
            if (!line) return
            if (line.startsWith('BLE_DEVICE_ADDRESS ')) {
              reportedBleAddress = line.slice('BLE_DEVICE_ADDRESS '.length).trim()
              return
            }
            if (line.includes('simulation mode')) { setBleStatus('simulation'); pluginLog('Python running in simulation mode') }
            else if (line.includes('Connected to OpenWind')) { setBleStatus('connected'); pluginLog('BLE connected') }
            else if (line.includes('disconnected')) { setBleStatus('disconnected'); pluginLog('BLE disconnected') }
            else if (line.includes('not found')) { setBleStatus('not_found'); pluginLog('BLE device not found') }
            else if (line.includes('Scanning')) { setBleStatus('scanning'); pluginLog('BLE scanning...') }
          })
        })

        pythonProcess.stderr.on('data', (data) => {
          pluginLog('Python: ' + data.toString().trim())
        })

        pythonProcess.on('close', (code) => {
          pythonProcess = null
        })

        pythonProcess.on('error', (err) => {
          pluginLog('Python process error: ' + err.message)
          pythonProcess = null
        })
      }

      // Find a working Python — prefer venv (has bleak) over system Python (simulation only)
      const venvPython = path.join(pluginDir, 'venv', 'bin', 'python')
      const pyCandidates = options.pythonPath
        ? [options.pythonPath, venvPython, 'python3', 'python']
        : [venvPython, 'python3', 'python']

      let pythonBin = null
      for (const candidate of pyCandidates) {
        try {
          execSync(`"${candidate}" --version`, { stdio: 'ignore' })
          pythonBin = candidate
          break
        } catch (e) { /* try next */ }
      }

      if (pythonBin) {
        startPythonProcess(pythonBin)

        // If the chosen Python doesn't have bleak, install it into a venv
        // in the background so BLE works on next restart
        try {
          execSync(`"${pythonBin}" -c "import bleak"`, { stdio: 'ignore', timeout: 10000 })
        } catch (e) {
          let sysPython = null
          for (const name of ['python3', 'python']) {
            try {
              execSync(`${name} --version`, { stdio: 'ignore' })
              sysPython = name
              break
            } catch (e2) { /* try next */ }
          }
          if (sysPython) {
            const venvDir = path.join(pluginDir, 'venv')
            const pipBin = path.join(venvDir, 'bin', 'pip')
            pluginLog('Installing bleak into venv for BLE support (restart plugin when done)…')
            depInstallProcess = exec(
              `"${sysPython}" -m venv "${venvDir}" && "${pipBin}" install bleak`,
              { timeout: 600000 },
              (err) => {
                depInstallProcess = null
                if (err) {
                  pluginLog('Failed to install bleak: ' + err.message)
                  return
                }
                pluginLog('bleak installed into venv — restart plugin to enable BLE')
              }
            )
          }
        }
      } else {
        app.error('OpenWind: Python 3 not found. Install Python 3 and restart the plugin.')
        pluginLog('Python 3 not found on this system')
      }


      timer = setInterval(() => {
        
        // If no data received for longer than the grace period, clear sensor values
        if (lastDataTime > 0 && (Date.now() - lastDataTime) > BLE_GRACE_PERIOD_MS) {
          realAWA = null
          realAWS = null
          sensorYAW = null
        }
        
        if (realAWA === null || realAWS === null) {
          // No wind data: when force recording is on, still push a row (e.g. at dock with no sensor)
          if (forceRecording && options.enableSessionLogging !== false) {
            const posRaw = app.getSelfPath('navigation.position.value') || app.getSelfPath('navigation.position')
            const posVal = posRaw && posRaw.value ? posRaw.value : posRaw
            const latitude = posVal && typeof posVal.latitude === 'number' ? posVal.latitude : null
            const longitude = posVal && typeof posVal.longitude === 'number' ? posVal.longitude : null
            const skHeading = app.getSelfPath('navigation.headingMagnetic.value')
            const heading = skHeading != null ? skHeading : (sensorYAW != null ? sensorYAW : 0)
            const row = {
              timestamp: new Date().toISOString(),
              latitude: latitude,
              longitude: longitude,
              awsKts: '',
              awaDeg: '',
              awdDeg: (heading * 180 / Math.PI + 360) % 360,
              twsKts: '',
              twaDeg: '',
              mastRotationDeg: 0,
              headingDeg: (heading * 180 / Math.PI + 360) % 360
            }
            sessionRows.push(row)
            if (sessionRows.length > sessionBufferSize) sessionRows.shift()
          }
          t += 0.1
          return
        }

        const skHeading = app.getSelfPath('navigation.headingMagnetic.value')
        // When sensor yaw is stuck at 270°, don't let it contaminate the
        // heading fallback chain — use SignalK heading if present, else 270°
        // as before. Real boat heading (from another SK source) is strongly
        // preferred in this case.
        const sensorYawForHeading = yawStuck ? null : sensorYAW
        latestHeading = skHeading != null ? skHeading : (sensorYawForHeading != null ? sensorYawForHeading : 270 * Math.PI / 180)

        // If the sensor's yaw is stuck, pretend the mast is aligned with the
        // boat so mastRotation collapses to yawOffset (≈ 0 by default) and
        // AWA is published as if it came straight off the sensor, without
        // factoring in a broken yaw reading.
        sensorYaw = yawStuck
          ? latestHeading
          : (sensorYAW !== null ? sensorYAW : latestHeading)
        sensorWindAngle = realAWA
        let windSpeed = realAWS

        // Mast rotation = (Sensor Yaw + Offset) - Boat Heading
        const correctedYaw = sensorYaw + yawOffset
        const mastRotation = correctedYaw - latestHeading

        // Apparent Wind Angle = Sensor Wind Angle + Mast Rotation
        const calcAngle = sensorWindAngle + mastRotation
        apparentAngle = Number.isFinite(calcAngle) ? calcAngle : 180 * Math.PI / 180

        if (apparentAngle > Math.PI) apparentAngle -= 2 * Math.PI
        if (apparentAngle < -Math.PI) apparentAngle += 2 * Math.PI

        // Session logging for CSV: read position and true wind, update activity, push row if gate passes
        const posRaw = app.getSelfPath('navigation.position.value') || app.getSelfPath('navigation.position')
        const posVal = posRaw && posRaw.value ? posRaw.value : posRaw
        const latitude = posVal && typeof posVal.latitude === 'number' ? posVal.latitude : null
        const longitude = posVal && typeof posVal.longitude === 'number' ? posVal.longitude : null
        const tws = app.getSelfPath('environment.wind.speedTrue.value')
        const twaWater = app.getSelfPath('environment.wind.angleTrueWater.value')
        const twaGround = app.getSelfPath('environment.wind.angleTrueGround.value')
        const trueWindSpeed = typeof tws === 'number' ? tws : null
        const trueWindAngle = typeof twaWater === 'number' ? twaWater : (typeof twaGround === 'number' ? twaGround : null)

        const positionChanged = (latitude != null && longitude != null) && (
          lastSessionLat == null || lastSessionLon == null ||
          Math.abs(latitude - lastSessionLat) > POSITION_CHANGE_DEG ||
          Math.abs(longitude - lastSessionLon) > POSITION_CHANGE_DEG
        )
        const headingChanged = lastSessionHeading == null || Math.abs(latestHeading - lastSessionHeading) > HEADING_CHANGE_RAD
        // Only refresh activity when position or heading actually changed (not on first tick), so we don't record when boat has never moved
        const hadPreviousFix = lastSessionLat != null || lastSessionLon != null || lastSessionHeading != null
        if ((positionChanged || headingChanged) && hadPreviousFix) {
          lastActivityTime = Date.now()
        }
        lastSessionLat = latitude
        lastSessionLon = longitude
        lastSessionHeading = latestHeading

        const shouldRecord = forceRecording || (Date.now() - lastActivityTime <= activityWindowMs)
        if (shouldRecord && (options.enableSessionLogging !== false)) {
          const awdDeg = ((latestHeading * 180 / Math.PI) + (apparentAngle * 180 / Math.PI) + 360) % 360
          const row = {
            timestamp: new Date().toISOString(),
            latitude: latitude,
            longitude: longitude,
            awsKts: windSpeed * 1.943844492440579,
            awaDeg: apparentAngle * 180 / Math.PI,
            awdDeg: awdDeg,
            twsKts: trueWindSpeed != null ? trueWindSpeed * 1.943844492440579 : '',
            twaDeg: trueWindAngle != null ? trueWindAngle * 180 / Math.PI : '',
            mastRotationDeg: mastRotation * 180 / Math.PI,
            headingDeg: (latestHeading * 180 / Math.PI + 360) % 360
          }
          sessionRows.push(row)
          if (sessionRows.length > sessionBufferSize) sessionRows.shift()
        }

        // Debug output every 10 seconds
        if (Math.floor(t * 10) % 10 === 0) {
          //console.log('Debug - SensorYaw:', (sensorYaw * 180 / Math.PI).toFixed(1) + '°', 'YawOffset:', (yawOffset * 180 / Math.PI).toFixed(1) + '°', 'CorrectedYaw:', (correctedYaw * 180 / Math.PI).toFixed(1) + '°', 'Heading:', (latestHeading * 180 / Math.PI).toFixed(1) + '°', 'MastRotation:', (mastRotation * 180 / Math.PI).toFixed(1) + '°', 'WindAngle:', (sensorWindAngle * 180 / Math.PI).toFixed(1) + '°', 'AWA:', (apparentAngle * 180 / Math.PI).toFixed(1) + '°')
        }

        const mastNmeaMode = options.mastRotationNmeaMode || 'none'
        const mastNmeaHost = (typeof options.mastRotationNmeaHost === 'string' ? options.mastRotationNmeaHost : '').trim()
        const mastNmeaPortRaw = options.mastRotationNmeaPort
        const mastNmeaPort = Number.isFinite(mastNmeaPortRaw) ? Math.floor(mastNmeaPortRaw) : 10110
        if (mastNmeaMode !== 'none' && mastNmeaHost && udpSocket) {
          const mastDeg = mastRotation * 180 / Math.PI
          const nmeaLine = formatMastRotationNmea(mastNmeaMode, mastDeg)
          if (nmeaLine) {
            udpSocket.send(Buffer.from(nmeaLine, 'utf8'), mastNmeaPort, mastNmeaHost, (err) => {
              if (err && options.enableDebug) pluginLog('Mast rotation NMEA UDP: ' + err.message)
            })
          }
        }

        app.handleMessage('plugin.open-wind', {
          updates: [
            {
              source: {
                label: 'open-wind',
                type: 'plugin',
                src: app.selfId
              },
              values: [
                { 
                  path: 'environment.wind.speedApparent', 
                  value: windSpeed,
                  meta: {
                    units: 'm/s',
                    description: 'Apparent wind speed'
                  }
                },
                { 
                  path: 'environment.wind.angleApparent', 
                  value: apparentAngle,
                  meta: {
                    units: 'rad',
                    description: 'Apparent wind angle relative to bow'
                  }
                },
                { 
                  path: 'sensors.mast.yaw', 
                  value: sensorYaw,
                  meta: {
                    units: 'rad',
                    description: 'Raw sensor yaw value'
                  }
                },
                {
                  path: 'sensors.mast.rotation',
                  value: mastRotation,
                  meta: {
                    units: 'rad',
                    description: 'Mast rotation relative to boat forward'
                  }
                },
                { 
                  path: 'sensors.mast.windAngle', 
                  value: sensorWindAngle,
                  meta: {
                    units: 'rad',
                    description: 'Raw wind angle from sensor'
                  }
                },
                {
                  path: 'debug-awa-degrees',
                  value: apparentAngle * 180 / Math.PI,
                  meta: {
                    units: 'deg',
                    description: 'Apparent wind angle relative to bow'
                  }
                },
                {
                  path: 'debug-wind-speed-knots',
                  value: windSpeed * 1.943844492440579,
                  meta: {
                    units: 'knots',
                    description: 'Apparent wind speed in knots'
                  }
                },
                {
                  path: 'debug-mast-rotation-degrees',
                  value: mastRotation * 180 / Math.PI,
                  meta: {
                    units: 'deg',
                    description: 'Mast rotation relative to boat forward in degrees'
                  }
                },
                {
                  path: 'debug-sensor-yaw-degrees',
                  value: sensorYaw * 180 / Math.PI,
                  meta: {
                    units: 'deg',
                    description: 'Raw mast top sensor yaw value in degrees'
                  }
                },
                {
                  path: 'sensors.openwind.bluetoothStatus',
                  value: bleStatus
                },
                {
                  path: 'sensors.openwind.pluginVersion',
                  value: pluginVersion
                },
                {
                  path: 'sensors.openwind.bleDeviceAddress',
                  value: reportedBleAddress
                },
                {
                  path: 'sensors.openwind.bleDeviceIdConfigured',
                  value: (typeof options.openWindBleDeviceId === 'string' ? options.openWindBleDeviceId : '').trim()
                }
              ]
            }
          ]
        })

        t += 0.1
      }, interval)
    },

    stop: function() {
      clearInterval(timer)
      timer = null
      restartPlugin = null
      reportedBleAddress = ''
      if (bleDisconnectTimer) { clearTimeout(bleDisconnectTimer); bleDisconnectTimer = null }
      
      if (udpSocket) {
        try { udpSocket.close() } catch (e) { /* already closed */ }
        udpSocket = null
      }
      
      if (depInstallProcess) {
        depInstallProcess.kill()
        depInstallProcess = null
      }

      if (pythonProcess) {
        pythonProcess.kill('SIGTERM')
        pythonProcess = null
      }

      if (logStream) {
        try { logStream.end() } catch (e) { /* ignore */ }
        logStream = null
      }
    },


    
    schema: {
      "type": "object",
      "properties": {
        "amplitude": {
          "type": "number",
          "title": "Max Wind Speed (m/s)",
          "default": 10
        },
        "interval": {
          "type": "number",
          "title": "Update Interval (ms)",
          "default": 1000
        },
        "yawOffset": {
          "type": "number",
          "title": "Yaw Sensor Offset (degrees)",
          "description": "Offset to add to sensor yaw to match boat heading when mast is centered. Positive values increase yaw, negative values decrease yaw.",
          "default": 0
        },
        "pythonPath": {
          "type": "string",
          "title": "Python Binary Path",
          "description": "Path to Python binary (e.g. /home/pi/venv/bin/python). Leave empty to auto-detect.",
          "default": ""
        },
        "reconnectDelay": {
          "type": "number",
          "title": "BLE reconnect delay (seconds)",
          "description": "How long to wait before reconnecting after a signal loss. The manufacturer recommends 10–20 seconds to give the sensor time to re-initialise. Default: 15.",
          "default": 15
        },
        "openWindBroadcastOnly": {
          "type": "boolean",
          "title": "Broadcast-only (no GATT connection)",
          "description": "When on (default), wind and yaw come only from BLE advertisements—no Bluetooth connection, so phones and apps can still connect to the sensor for calibration. When off, the plugin uses a legacy GATT connection (exclusive). Turn off only if your firmware does not broadcast wind data.",
          "default": true
        },
        "openWindBleDeviceId": {
          "type": "string",
          "title": "OpenWind BLE address / id (optional)",
          "description": "If set, only this sensor is used (Linux: MAC like AA:BB:CC:DD:EE:FF; macOS CoreBluetooth: UUID string). Leave empty to auto-pick the first OpenWind seen and remember it in the plugin cache file. Use this when two OpenWinds are in range.",
          "default": ""
        },
        "yawStuckFrames": {
          "type": "number",
          "title": "Yaw stuck-at-270° threshold (frames)",
          "description": "Some OpenWind units intermittently broadcast a yaw word of 0x0000 which decodes to exactly 270°. After this many consecutive 270.0° frames (~0.25 s each) the plugin stops factoring the sensor yaw into the wind computation and treats the mast as aligned with the boat (mast rotation = 0). All other values pass through unchanged. Default: 10.",
          "default": 10
        },
        "forceSimulation": {
          "type": "boolean",
          "title": "Force simulation mode",
          "description": "When on, the Python script sends dummy wind/yaw data over UDP instead of connecting to a real OpenWind BLE device. Use for development or testing (e.g. in Docker) without hardware.",
          "default": false
        },
        "enableSessionLogging": {
          "type": "boolean",
          "title": "Enable session logging",
          "description": "Record session data for CSV download (position, wind, heading). When off, no rows are pushed.",
          "default": true
        },
        "sessionBufferSize": {
          "type": "number",
          "title": "Session buffer size",
          "description": "Max number of session rows to keep in memory (e.g. 86400 = ~24 hours at 1 s interval).",
          "default": 86400
        },
        "sessionActivityWindowMs": {
          "type": "number",
          "title": "Session activity window (ms)",
          "description": "Only record when boat has moved or rotated within this many ms (e.g. 3600000 = 1 hour). Ignored if Force recording is on.",
          "default": 3600000
        },
        "mastRotationNmeaMode": {
          "type": "string",
          "title": "Mast rotation NMEA output",
          "description": "Send mast rotation (signed degrees, same as sensors.mast.rotation) as NMEA 0183 over UDP when Mast rotation NMEA host is set. Rudder: RSA (rudder-angle gauge). Heel/roll: XDR with ROLL transducer (heel-style gauge on many plotters).",
          "enum": ["none", "rudder_rsa", "heel_roll_xdr"],
          "default": "none"
        },
        "mastRotationNmeaHost": {
          "type": "string",
          "title": "Mast rotation NMEA UDP host",
          "description": "Destination IP or hostname for mast rotation sentences (e.g. serial bridge or 127.0.0.1). Leave empty to disable. Uses the same update interval as wind data; not port 2000 (that is inbound from OpenWind only).",
          "default": ""
        },
        "mastRotationNmeaPort": {
          "type": "number",
          "title": "Mast rotation NMEA UDP port",
          "description": "UDP destination port for mast rotation NMEA (default 10110).",
          "default": 10110
        }
      }
    }
  }
}
