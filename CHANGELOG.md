# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.2] - 2024-01-XX

### Fixed
- Fixed Python installation for externally managed environments (Ubuntu/Debian)
- Added support for --break-system-packages and --user flags
- Enhanced error handling with multiple fallback installation methods
- Improved documentation for Python installation troubleshooting

### Added
- Smart Python dependency installation with multiple fallback methods
- Better error messages and user guidance for Python installation issues
- Comprehensive troubleshooting guide for externally managed Python environments

## [1.0.1] - 2024-01-XX

### Fixed
- Fixed Signal K app store installation issues
- Separated Python dependencies installation for app store compatibility
- Enhanced install script to detect app store installations
- Improved error handling and user feedback

### Added
- Separate `install-python-deps.sh` script for app store installations
- Better detection of existing plugin installations
- Enhanced startup script with improved plugin checking

### Changed
- Updated package.json with proper npm scripts
- Improved installation documentation
- Enhanced README with GitHub badges and better formatting

## [1.0.0] - 2024-01-XX

### Added
- Initial release of Signal K Open Wind Plugin
- Wind data integration from OpenWind sensor
- Mast rotation compensation using NMEA2000 heading data
- Debug data output for monitoring and troubleshooting
- Automatic reinstallation system for Signal K server updates
- Web interface for plugin configuration
- Python data processor for sensor communication
- UDP data format support for NMEA sentences
- Comprehensive installation and setup scripts

### Features
- **Wind Data Integration**: Processes apparent wind speed and angle from OpenWind sensor
- **Mast Rotation Compensation**: Determines mast rotation via OpenWind Yaw data
- **Debug Data**: Comprehensive debug information for monitoring and troubleshooting
- **Auto-Reinstallation**: Survives Signal K server updates automatically
- **Plugin Settings**: Configurable through Signal K admin interface
- **UDP Support**: Listens for NMEA sentences on UDP port 2000
- **Python Dependencies**: Requires numpy and bleak for sensor communication

### Technical Details
- Signal K data paths for wind and sensor data
- Plugin settings for max wind speed, update interval, and yaw sensor offset
- Support for NMEA2000 boat heading integration
- Robust startup scripts with systemd service support
- Comprehensive troubleshooting documentation

## [1.0.0] - 2024-01-XX

### Added
- Initial release
- Core wind data processing functionality
- OpenWind sensor integration
- Signal K plugin framework implementation
- Installation and setup automation
- Documentation and troubleshooting guides

---

## Version History

- **v1.0.0**: Initial release with core functionality
- **Future versions**: Will be documented here as they are released

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute to this project.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
