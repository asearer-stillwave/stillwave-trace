# Stillwave Trace

> Licensed under the Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Trace is a small software-defined-radio station for a Raspberry Pi and an RTL-SDR USB dongle. It runs from a touch screen, a TV or a phone browser, and over the local network:

- **Listen:** FM, airband and NOAA weather, streamed through Icecast, with presets.
- **Spectrum and scan:** live spectrum and waterfall, and a band scanner.
- **Map:** ADS-B aircraft on an offline vector map (MapLibre GL JS with a Protomaps basemap).
- **Extras:** Bluetooth speaker output, a phone hotspot, screenshots, text size and kiosk settings, and signed over-the-air updates.

Trace was earlier called Quietline Fieldnote. Commands, services and files keep their `sdr-*` and `fieldnote-*` names, so an installed Pi upgrades in place.

## Two editions

| Folder | For | Notes |
| --- | --- | --- |
| [`handheld/`](handheld) | 5″ Raspberry Pi Touch Display 2 (portrait) and phones | Version 1.2.0 |
| [`desktop/`](desktop) | An HDMI monitor or TV (kiosk browser) | Version 1.2.0-desktop. Updates are never exchanged with the handheld edition. |

Each folder is a complete, separate package with its own `install.sh`, `README.md` (full documentation), `CHANGELOG.md` and `verify.sh`.

## Hardware

- **Raspberry Pi 4** running Ubuntu 24.04 (arm64) is the tested platform for both editions.
- **Raspberry Pi 5** is **experimental**. The desktop edition has been run on one Pi 5 and is much faster, but the installer has no Pi 5 branch yet and known issues remain (see the changelog and open issues).
- An RTL2832U / R820T2 USB dongle such as the Nooelec NESDR.

## Install

Copy the edition folder you want to the Pi (for example with `scp -r`, or clone this repository on the Pi), then run its installer:

```bash
# handheld edition (5" touch display)
cd handheld && sudo bash install.sh
# desktop edition (HDMI monitor)
cd desktop && sudo bash install.sh --display hdmi
sudo reboot
```

The installer needs internet once for `apt` packages. Afterwards run `bash verify.sh`. Read the edition's `README.md` before installing: it covers the display options, Wi-Fi and hotspot, Bluetooth and troubleshooting.

**Offline map.** The 55 MB map tile file (`maps/la.pmtiles`) is not stored in this repository. After installing, run `sudo sdr-maps fetch` on the Pi (needs internet once). It cuts a Los Angeles extract from the public Protomaps build and installs it. Without it the map falls back to a plain outline.

## Updates (OTA)

Trace updates itself over the air: **More > Updates** on the web UI, or `sudo sdr-update check` and `sudo sdr-update apply` over SSH. Each update is a signed package (`.ota`, or a `.tar.gz` with its `.sig`). The Pi only holds the public key (`config/stillwave-update.pub`) and refuses a package whose Ed25519 signature does not verify. Updates install regardless of date; the old per-unit license system is gone.

To publish your own builds, generate your own Ed25519 update key pair, put your public key in `config/stillwave-update.pub` and sign with `tools/make_release.py`. Keep the private key out of the repository (it is in `.gitignore`). Units only accept updates signed by the key they carry, so units running an official build keep receiving only official updates.

## Repository layout

```
handheld/   handheld edition (install.sh, bin/, web/, systemd/, config/, vendor/, docs)
desktop/    desktop edition
tools/      release tooling (signed OTA packages, zip bundles); no keys included
LICENSE     Apache License 2.0
NOTICE      third-party credits: OpenStreetMap (ODbL), Protomaps, MapLibre, fonts, grim
```

## License

Apache License 2.0. See [LICENSE](LICENSE). Third-party components keep their own licenses, listed in [NOTICE](NOTICE). Map data is © OpenStreetMap contributors (ODbL); keep the attribution visible in the map.

Pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
