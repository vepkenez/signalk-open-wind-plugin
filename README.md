# Signal K Open Wind Plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen.svg)](https://nodejs.org/)
[![Signal K Plugin](https://img.shields.io/badge/Signal%20K-Plugin-blue.svg)](https://signalk.org/)
[![GitHub Issues](https://img.shields.io/github/issues/vepkenez/signalk-open-wind-plugin.svg)](https://github.com/vepkenez/signalk-open-wind-plugin/issues)
[![GitHub Stars](https://img.shields.io/github/stars/vepkenez/signalk-open-wind-plugin.svg)](https://github.com/vepkenez/signalk-open-wind-plugin/stargazers)

A robust Signal K plugin for integrating [OpenWind](https://www.openwind.de) mast wind sensor data with automatic reinstallation capabilities. This repository is a community Signal K integration; the **OpenWind** instrument (AWA/AWS, compass, motion, BLE, and related ecosystem) is designed and sold by the team behind [openwind.de](https://www.openwind.de).

## Table of Contents

- [Features](#features)
- [Requirements](#requires)
- [Installation](#installation)
  - [Quick Install](#quick-install)
  - [Manual Install](#manual-install)
- [Uninstall](#uninstall)
- [Configuration](#configuration)
- [Plugin Settings](#plugin-settings)
- [UDP Data Format](#udp-data-format)
- [Python Dependencies](#python-dependencies)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)
- [Support](#support)
- [Acknowledgements](#acknowledgements)

## Features

- **Wind Data Integration**: Processes apparent wind speed and angle from OpenWind sensor
- **Mast Rotation Compensation**: Determines mast rotation via OpenWind Yaw data
- Subtracts mast yaw from available NMEA2000 boat heading to output mast rotation compensated wind data
- use existing SignalK facilities to send wind data to N2K network.
- **Debug Data**: Comprehensive debug information for monitoring and troubleshooting
- **Auto-Reinstallation**: Survives Signal K server updates automatically

## Requires
- OpenWind Sensor
- RaspberryPi with NMEA2000/CANBUS communication capability
- NMEA2000 heading data from some external source

## Installation

### Quick Install

```bash
git clone https://github.com/vepkenez/signalk-open-wind-plugin.git
cd signalk-open-wind-plugin
npm run install
```

### Alternative: Direct Installation

```bash
# Install directly from GitHub
cd ~/.signalk
npm install https://github.com/vepkenez/signalk-open-wind-plugin.git
npm run install
```

### Manual Install (Advanced)

If you prefer manual installation:

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

## Uninstall

If you installed the plugin via the Signal K app store and then ran `./install.sh` or `npm run setup`, the setup script has modified your Signal K config directory so the plugin is **automatically reinstalled** on every server start. That prevents a normal app-store uninstall from sticking: after you uninstall, the next restart reinstalls the plugin.

To fully uninstall:

1. **Revert the setup changes** so the server no longer reinstalls the plugin:
   - Restore the original `~/.signalk/signalk-server` from the backup (if it exists):
     ```bash
     cp ~/.signalk/signalk-server.backup.YYYYMMDD_HHMMSS ~/.signalk/signalk-server
     ```
     Use the latest `signalk-server.backup.*` file. Or run the provided script:
     ```bash
     ./uninstall-setup.sh
     ```
   - Remove the reinstall script so this plugin is not re-added on start:
     ```bash
     rm ~/.signalk/startup-plugins.sh
     ```
     If you use `startup-plugins.sh` for other plugins, edit it instead and remove only the line `check_and_install "signalk-open-wind-plugin"`.

2. **Uninstall the plugin** via the Signal K app store (or run `cd ~/.signalk && npm uninstall signalk-open-wind-plugin`).

3. **Restart Signal K.** The plugin should stay uninstalled.

Optional log file (only created if you enabled logging in the plugin): you can delete `~/.signalk/open-wind-plugin.log` if present.

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

**These are automatically installed** when you run `npm run install`. The installer will try multiple methods to handle different Python environments.

### Manual Installation (if automatic fails)

If the automatic installation fails (common on newer Ubuntu/Debian systems with externally managed Python environments):

```bash
# Try normal installation first
pip3 install numpy bleak

# If that fails, try with --break-system-packages
pip3 install --break-system-packages numpy bleak

# Or install for user only
pip3 install --user numpy bleak
```

### Troubleshooting Python Installation

**Error: "externally-managed-environment"**
- This is a security feature in newer Python systems
- Use `--break-system-packages` flag (as shown above)
- Or use `--user` flag for user-only installation

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

### Wind not visible on NMEA 2000 network

Wind is sent to N2K by the **signalk-to-nmea2000** plugin (not by this plugin). This plugin only publishes to Signal K; signalk-to-nmea2000 converts that to PGN 130306 and emits it. If other devices don’t see wind:

1. **Plugin config (Signal K → Server → Plugins → Signal K to NMEA 2000)**  
   - Ensure **WINDv2** is **Enabled**.  
   - Set **Source for environment.wind.angleApparent** to your open-wind source (e.g. `open-wind.urn:mrn:signalk:uuid:...`).  
   - Set **Source for environment.wind.speedApparent** to the same source (or leave blank to use any source). Saving applies the change.

2. **Confirm Signal K has wind**  
   - In Admin UI, Data Browser (or REST): check `environment.wind.angleApparent` and `environment.wind.speedApparent` and that their `$source` is the open-wind plugin.

3. **Confirm N2K connection can write**  
   - In Server → Data Connections, the NMEA 2000 connection (e.g. can0) must be able to **write** (not read-only). If your setup only has an “input” pipe, add or use a connection that supports output (same interface is often bidirectional).

4. **Check for PGN 130306 on the bus**  
   On the Pi (or host with can0):
   ```bash
   candump can0 | grep -E '130306|1FD02'
   ```
   If you see lines when wind is updating in Signal K, the plugin is sending; if not, the problem is before the bus (config or connection).

5. **Enable debug (optional)**  
   In Signal K Admin, enable debug logging, restart, then check the server log for lines like `emit nmea2000JsonOut` to confirm the N2K plugin is emitting wind PGNs.

## Development

### Live webapp development

You can run Signal K in Docker and the webapp with hot reload so frontend changes appear immediately. The dev server (Vite) requires Node 18+.

1. **Install dev dependency** (once): `npm install`
2. **Start Signal K in Docker**: `npm run dev:docker`  
   - Starts `signalk/signalk-server` with the plugin installed and enabled; config is persisted in a Docker volume.
3. **Start the dev server**: `npm run dev`  
   - Serves `public/` at http://localhost:5173/ with Vite and proxies `/signalk` (API + WebSocket) to the container.
4. **Open** http://localhost:5173/ in your browser. Edit files in `public/` (e.g. `index.html`) and save; the page will reload automatically.

To stop the container: `docker compose -f docker-compose.dev.yml down`.

### File Structure

```
signalk-open-wind-plugin/
├── plugin/
│   ├── index.js              # Main plugin code
│   └── OpenWind.py           # BLE → UDP bridge (Python/bleak)
├── public/
│   └── index.html            # Web dashboard
├── package.json              # Plugin metadata
├── install.sh                # Optional post-install setup (npm run setup)
├── uninstall-setup.sh        # Revert install.sh changes so app-store uninstall works
├── install-python-deps.sh    # Python dependency installer (runs on postinstall)
├── test-docker.sh            # Docker integration test
└── README.md
```

### Testing

The project includes a Docker-based integration test that spins up a clean SignalK server, installs the plugin, and verifies everything works. Requires Docker.

```bash
npm test
# or
./test-docker.sh
```

The test will:
1. Start a fresh SignalK server container
2. Install the plugin via `npm install`
3. Enable the plugin and restart
4. Verify all Signal K data paths are publishing
5. Verify the webapp is served at `/open-wind`
6. Clean up the container

The full run takes about a minute.

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

## Acknowledgements

**OpenWind hardware** — This plugin exists to bring [OpenWind](https://www.openwind.de) sensor data into Signal K. Special thanks to the OpenWind manufacturer and product team for the device, documentation, and BLE broadcast behaviour that make integrations like this possible.

OpenWind is a trademark of its respective owner; this plugin is not affiliated with or endorsed by the OpenWind manufacturer or [openwind.de](https://www.openwind.de) unless they say otherwise. For calibration, firmware, apps, and official support, use the manufacturer’s site and apps.
