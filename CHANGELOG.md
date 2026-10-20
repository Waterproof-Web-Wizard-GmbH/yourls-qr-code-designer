# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-20

### Added
- Designer page with live preview and a "QR" button in the YOURLS link list.
- Colours and linear gradients for dots and corner markers, transparent background.
- Six dot styles, four corner frames, three corner dots, dot gap from 0 to 30 %.
- Logo in PNG, JPG, WebP or SVG, kept in the browser, placed freely inside the safe area (sliders or drag), free space of 0 to 3 modules, coverage limited to 15 %, automatic error correction H.
- Print check: export size from printed width and dpi, module size, minimum size for the scan distance, logo resolution.
- Built-in scan test with jsQR at four sizes, confirmation before downloading a code that failed.
- PNG, SVG and JPG download from 200 to 6000 px, "Copy PNG" to the clipboard, quiet zone in modules.
- Presets (Classic, Rounded, Dots, Spaced squares), browser default including the logo, `qrcd_presets` filter with validation and logo URLs.
- English and German translations.
- Tests: official YOURLS test suite for plugins, Node tests that render and decode real codes, headless smoke test of the admin page, vendor check against npm. CI on PHP 8.1, 8.3 and 8.4.

[1.0.0]: https://github.com/Waterproof-Web-Wizard-GmbH/yourls-qr-code-designer/releases/tag/v1.0.0
