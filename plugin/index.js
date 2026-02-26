module.exports = function(app) {
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
  let bleStatus = 'disconnected'
  let lastDataTime = 0
  let bleDisconnectTimer = null
  const BLE_GRACE_PERIOD_MS = 5000
  const pluginVersion = require('../package.json').version

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
  function pluginLog(msg) {
    const ts = new Date().toISOString().slice(11, 19)
    logBuffer.push(`${ts} ${msg}`)
    if (logBuffer.length > LOG_MAX) logBuffer.shift()
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
    "description": "Simulates apparent wind including mast rotation and heading correction.",
    "version": "1.0.0",
    "webapp": "public",
    start: function(options) {
      const amplitude = options.amplitude || 10
      const interval = options.interval || 1000
      // Convert degrees to radians for yaw offset
      yawOffset = (options.yawOffset || 0) * Math.PI / 180

      // Register webapp routes
      const path = require('path')
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

      // UDP listener for OpenWind data
      const dgram = require('dgram')
      const udpSocket = dgram.createSocket('udp4')
      
      udpSocket.on('message', (msg, rinfo) => {
        const nmeaSentence = msg.toString().trim()
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
            sensorYAW = parseFloat(parts[1]) * Math.PI / 180  // Convert to radians
            pluginLog('Yaw=' + (sensorYAW * 180 / Math.PI).toFixed(1) + '°')
          }
        }
      })
      
      udpSocket.bind(2000, '127.0.0.1', () => {
        //console.log('UDP listener started on port 2000 for OpenWind data')
      })
      
      // Spawn Python process for OpenWind
      const { spawn, execSync, exec } = require('child_process')
      const pythonScript = path.join(__dirname, 'OpenWind.py')
      const pluginDir = path.join(__dirname, '..')

      function startPythonProcess(pythonBin) {
        pluginLog('Starting Python process: ' + pythonBin)
        pythonProcess = spawn(pythonBin, ['-u', pythonScript], {
          stdio: ['pipe', 'pipe', 'pipe']
        })

        pythonProcess.stdout.on('data', (data) => {
          data.toString().split('\n').forEach(line => {
            line = line.trim()
            if (!line) return
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
          t += 0.1
          return
        }

        latestHeading = app.getSelfPath('navigation.headingMagnetic.value') || (sensorYAW != null ? sensorYAW : 0) || 270 * Math.PI / 180

        sensorYaw = sensorYAW !== null ? sensorYAW : latestHeading
        sensorWindAngle = realAWA
        let windSpeed = realAWS

        // Mast rotation = (Sensor Yaw + Offset) - Boat Heading
        const correctedYaw = sensorYaw + yawOffset
        const mastRotation = correctedYaw - latestHeading

        // Apparent Wind Angle = Sensor Wind Angle + Mast Rotation
        apparentAngle = (sensorWindAngle + mastRotation) || 180 * Math.PI / 180

        if (apparentAngle > Math.PI) apparentAngle -= 2 * Math.PI
        if (apparentAngle < -Math.PI) apparentAngle += 2 * Math.PI
        
        // Debug output every 10 seconds
        if (Math.floor(t * 10) % 10 === 0) {
          //console.log('Debug - SensorYaw:', (sensorYaw * 180 / Math.PI).toFixed(1) + '°', 'YawOffset:', (yawOffset * 180 / Math.PI).toFixed(1) + '°', 'CorrectedYaw:', (correctedYaw * 180 / Math.PI).toFixed(1) + '°', 'Heading:', (latestHeading * 180 / Math.PI).toFixed(1) + '°', 'MastRotation:', (mastRotation * 180 / Math.PI).toFixed(1) + '°', 'WindAngle:', (sensorWindAngle * 180 / Math.PI).toFixed(1) + '°', 'AWA:', (apparentAngle * 180 / Math.PI).toFixed(1) + '°')
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
                    description: 'Apparent wind angle relative to bow'
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
      if (bleDisconnectTimer) { clearTimeout(bleDisconnectTimer); bleDisconnectTimer = null }
      
      // Close UDP socket if it exists
      if (typeof udpSocket !== 'undefined') {
        udpSocket.close()
        //console.log('UDP socket closed')
      }
      
      if (depInstallProcess) {
        depInstallProcess.kill()
        depInstallProcess = null
      }

      if (pythonProcess) {
        pythonProcess.kill('SIGTERM')
        pythonProcess = null
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
        }
      }
    }
  }
}
