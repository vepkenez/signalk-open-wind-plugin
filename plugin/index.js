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
      app.get('/open-wind', (req, res) => {
        res.sendFile(__dirname + '/../public/index.html')
      })
      
      // UDP listener for OpenWind data
      const dgram = require('dgram')
      const udpSocket = dgram.createSocket('udp4')
      
      udpSocket.on('message', (msg, rinfo) => {
        const nmeaSentence = msg.toString().trim()
        console.log('Received NMEA from OpenWind:', nmeaSentence)
        
        // Parse NMEA sentences
        if (nmeaSentence.startsWith('$WIMWV')) {
          // Wind data: $WIMWV,angle,R,speed,N,A*checksum
          const parts = nmeaSentence.split(',')
          if (parts.length >= 4) {
            realAWA = parseFloat(parts[1]) * Math.PI / 180  // Convert to radians
            realAWS = parseFloat(parts[3]) * 0.514444  // Convert knots to m/s
            console.log('Parsed wind data - AWA:', realAWA * 180 / Math.PI, 'AWS:', realAWS)
          }
        } else if (nmeaSentence.startsWith('$WIHDM')) {
          // Heading data: $WIHDM,heading,M*checksum
          const parts = nmeaSentence.split(',')
          if (parts.length >= 2) {
            sensorYAW = parseFloat(parts[1]) * Math.PI / 180  // Convert to radians
            console.log('Parsed heading data - YAW:', sensorYAW * 180 / Math.PI)
          }
        }
      })
      
      udpSocket.bind(2000, '127.0.0.1', () => {
        //console.log('UDP listener started on port 2000 for OpenWind data')
      })
      
      // Spawn Python process for OpenWind
      const { spawn } = require('child_process')
      const pythonPath = __dirname + '/OpenWind.py'
      
      //console.log('Starting OpenWind Python process...')
      pythonProcess = spawn('/home/damon/penv/bin/python', [pythonPath], {
        stdio: ['pipe', 'pipe', 'pipe']
      })
      
      pythonProcess.stdout.on('data', (data) => {
        //console.log('OpenWind Python output:', data.toString().trim())
      })
      
      pythonProcess.stderr.on('data', (data) => {
        //console.log('OpenWind Python error:', data.toString().trim())
      })
      
      pythonProcess.on('close', (code) => {
        //console.log(`OpenWind Python process exited with code ${code}`)
        pythonProcess = null
      })
      
      pythonProcess.on('error', (err) => {
        //console.log('OpenWind Python process error:', err)
        pythonProcess = null
      })
      
      // Log successful startup
      pythonProcess.on('spawn', () => {
        //console.log('OpenWind Python process started successfully')
      })


      timer = setInterval(() => {
        
        latestHeading = app.getSelfPath('navigation.headingMagnetic.value') || (sensorYAW != null ? sensorYAW : 0) || 270 * Math.PI / 180
        
        // Use real OpenWind sensor data if available, otherwise fall back to simulated
        let windSpeed
        if (sensorYAW !== null) {
          sensorYaw = sensorYAW
          sensorWindAngle = realAWA
          windSpeed = realAWS
        } else {
          // Fallback to simulated values
          sensorYaw = latestHeading
          // Simulated wind angle varies between 90° and 270° (π/2 to 3π/2 radians)
          sensorWindAngle = Math.PI / 2 + Math.sin(t / 10) * Math.PI
          windSpeed = amplitude * 0.5 * (Math.sin(t) + 1)
        }

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
      
      // Close UDP socket if it exists
      if (typeof udpSocket !== 'undefined') {
        udpSocket.close()
        //console.log('UDP socket closed')
      }
      
      // Terminate Python process if it exists
      if (pythonProcess) {
        //console.log('Terminating OpenWind Python process...')
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
        }
      }
    }
  }
}
