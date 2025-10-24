# Signal K Open Wind Plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen.svg)](https://nodejs.org/)
[![Signal K Plugin](https://img.shields.io/badge/Signal%20K-Plugin-blue.svg)](https://signalk.org/)
[![GitHub Issues](https://img.shields.io/github/issues/vepkenez/signalk-open-wind-plugin.svg)](https://github.com/vepkenez/signalk-open-wind-plugin/issues)
[![GitHub Stars](https://img.shields.io/github/stars/vepkenez/signalk-open-wind-plugin.svg)](https://github.com/vepkenez/signalk-open-wind-plugin/stargazers)

A robust Signal K plugin for integrating OpenWind sensor data with automatic reinstallation capabilities.

## Table of Contents

- [Features](#features)
- [Requirements](#requires)
- [Installation](#installation)
  - [Quick Install](#quick-install)
  - [Manual Install](#manual-install)
- [Configuration](#configuration)
- [Plugin Settings](#plugin-settings)
- [UDP Data Format](#udp-data-format)
- [Python Dependencies](#python-dependencies)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)
- [Support](#support)

## Features

- **Wind Data Integration**: Processes apparent wind speed and angle from OpenWind sensor
- **Mast Rotation Compensation**: Determines mast rotation via OpenWind Yaw data
- Uses available NMEA2000 boat heading to determine mast rotation value
- **Debug Data**: Comprehensive debug information for monitoring and troubleshooting
- **Auto-Reinstallation**: Survives Signal K server updates automatically

## Requires
- OpenWind Sensor
- RaspberryPi with NMEA2000/CANBUS communication capability
- NMEA2000 heading data from some external source

## Installation

### Quick Install

```bash
git clone <your-repo-url>
cd signalk-open-wind-plugin
./install.sh
```

### Manual Install

1. Copy plugin to Signal K directory:
   ```bash
   cd ~/.signalk
   npm install /path/to/signalk-open-wind-plugin
   ```

2. Create startup script:
   ```bash
   # Create startup-plugins.sh in ~/.signalk/
   # (See install.sh for the script content)
   ```

3. Modify Signal K server startup script:
   ```bash
   # Modify ~/.signalk/signalk-server to call startup-plugins.sh
   ```

## Configuration

The plugin provides the following Signal K data paths:

### Wind Data
- `environment.wind.speedApparent` - Apparent wind speed (m/s)
- `environment.wind.angleApparent` - Apparent wind angle (rad)

### Sensor Data
- `sensors.mast.yaw` - Raw sensor yaw value (rad)
- `sensors.mast.windAngle` - Raw wind angle from sensor (rad)

### Debug Data
- `debug-awa-degrees` - Apparent wind angle in degrees
- `debug-wind-speed-knots` - Wind speed in knots
- `debug-mast-rotation-degrees` - Mast rotation in degrees
- `debug-sensor-yaw-degrees` - Raw sensor yaw in degrees

## Plugin Settings

Configure the plugin through the Signal K admin interface:

- **Max Wind Speed (m/s)**: Maximum simulated wind speed (default: 10)
- **Update Interval (ms)**: Data update frequency (default: 1000)
- **Yaw Sensor Offset (degrees)**: Offset to calibrate sensor yaw (default: 0)

## UDP Data Format

The plugin listens for NMEA sentences on UDP port 2000:

- `$WIMWV,angle,R,speed,N,A*checksum` - Wind data
- `$WIHDM,heading,M*checksum` - Heading data

## Python Dependencies

The plugin requires Python with the following packages:
- `numpy`
- `bleak` (for Bluetooth communication)

Install with:
```bash
pip install numpy bleak
```

## Troubleshooting

### Plugin Not Loading After Server Update

The automatic reinstallation system should handle this, but if issues persist:

1. Check the startup script:
   ```bash
   ~/.signalk/startup-plugins.sh
   ```

2. Verify plugin installation:
   ```bash
   ls -la ~/.signalk/node_modules/open-wind
   ```

3. Check Signal K logs:
   ```bash
   tail -f ~/.signalk/skserver-raw_*.log
   ```

### Debug Data Not Appearing

1. Verify plugin is enabled in Signal K admin interface
2. Check plugin configuration settings
3. Monitor debug output in Signal K logs

### Python Process Issues

1. Verify Python environment:
   ```bash
   /home/damon/penv/bin/python --version
   ```

2. Check Python dependencies:
   ```bash
   /home/damon/penv/bin/python -c "import numpy, bleak"
   ```

## Development

### File Structure

```
signalk-open-wind-plugin/
├── plugin/
│   ├── index.js          # Main plugin code
│   └── OpenWind.py       # Python data processor
├── public/
│   └── index.html        # Web interface
├── package.json          # Plugin metadata
├── install.sh           # Installation script
└── README.md            # This file
```

### Testing

Test the plugin installation:
```bash
# Remove plugin to simulate server update
rm ~/.signalk/node_modules/open-wind

# Start server (should auto-reinstall)
~/.signalk/signalk-server

# Verify plugin is working
curl http://localhost:3000/signalk/v1/api/vessels/self | grep open-wind
```

## License

MIT License - see LICENSE file for details.

## Disclaimer

**IMPORTANT SAFETY NOTICE**: This software is provided for educational and experimental purposes. The authors and contributors are not responsible for any damage, injury, or loss that may result from the use of this software in marine environments. Always verify wind data with multiple sources and never rely solely on this plugin for navigation or safety-critical decisions. Use at your own risk.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Support

For issues and questions:
- Check the troubleshooting section above
- Review Signal K server logs
- Verify plugin configuration in Signal K admin interface
