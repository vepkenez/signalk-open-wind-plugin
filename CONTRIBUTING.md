# Contributing to Signal K Open Wind Plugin

Thank you for your interest in contributing to the Signal K Open Wind Plugin! This document provides guidelines and information for contributors.

## Code of Conduct

This project adheres to a code of conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## How to Contribute

### Reporting Issues

- Use the GitHub issue tracker to report bugs or request features
- Include as much detail as possible:
  - Signal K server version
  - Plugin version
  - Operating system
  - Steps to reproduce
  - Expected vs actual behavior

### Submitting Changes

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/yourusername/signalk-open-wind-plugin.git
   cd signalk-open-wind-plugin
   ```
3. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. **Make your changes** and test thoroughly
5. **Commit your changes**:
   ```bash
   git commit -m "Add: brief description of changes"
   ```
6. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```
7. **Create a Pull Request** on GitHub

### Development Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Install Python dependencies**:
   ```bash
   pip install numpy bleak
   ```

3. **Test the plugin**:
   ```bash
   # Install in Signal K
   ./install.sh
   
   # Start Signal K server
   ~/.signalk/signalk-server
   
   # Test plugin functionality
   curl http://localhost:3000/signalk/v1/api/vessels/self | grep open-wind
   ```

### Coding Standards

- **JavaScript**: Follow standard Node.js conventions
- **Python**: Follow PEP 8 style guidelines
- **Documentation**: Update README.md for user-facing changes
- **Testing**: Test your changes thoroughly before submitting

### Commit Message Format

Use clear, descriptive commit messages:
- `Add:` for new features
- `Fix:` for bug fixes
- `Update:` for updates to existing features
- `Remove:` for removing features
- `Docs:` for documentation changes

### Pull Request Guidelines

- Keep PRs focused and reasonably sized
- Include tests for new functionality
- Update documentation as needed
- Ensure all tests pass
- Add yourself to the contributors list if this is your first contribution

## Development Areas

We welcome contributions in these areas:

- **Bug fixes** and stability improvements
- **New features** for wind data processing
- **Documentation** improvements
- **Testing** and test coverage
- **Performance** optimizations
- **UI/UX** improvements for the web interface

## Questions?

If you have questions about contributing, please:
- Open an issue with the "question" label
- Check existing issues and discussions
- Review the documentation in the README

Thank you for contributing to the Signal K Open Wind Plugin! 🚢⛵
