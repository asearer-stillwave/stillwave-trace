# Changelog: Stillwave Trace

Trace was earlier called Quietline Fieldnote; before that it was the "Neo SDR station" package (`sdr-station`).
Format: [Keep a Changelog](https://keepachangelog.com/). Newest first. Times are Pacific (PT).
Sources: build logs (`PROGRESS-*.md`), READMEs, VERSION files and the timestamped backups in `/workspace/sdr/backup/`.
Before 1.0.2 there are no per-version build logs, so those dates are taken from backup timestamps and say "by".

## [1.2.4] and [1.2.4-desktop] - 2026-10-22 (PT) - weak power supply warning; both editions
### Added
- **Weak power supply warning.** The web service checks the Pi's under-voltage flags every 5 s (`vcgencmd get_throttled` bits 0 and 16, and/or the `rpi_volt` hwmon `in0_lcrit_alarm`; Pi 4 and Pi 5; a missing tool is skipped). Each new event is logged (`[power] under-voltage … at HH:MM`) and kept for this boot in `/run/sdr-power/psu.json`. No I2C access at all.
- **Banner on every main page:** "Power supply too weak. Use a stronger battery (5 V, 3 A or more)." It pushes the content down; ✕ hides it until the next new weak-power event.
- **More › This box › Power supply** (first row): green "Power OK" or orange "Weak supply seen at HH:MM".
- **`GET /api/power/supply`** (state ok / weak_now / weak_seen / unknown, seen_at, event count). `/api/strip` carries the same data, so the pages poll nothing extra.
- **`sdr-psu`** (`/usr/local/sbin`): `sdr-psu status` (raw flags + last event), `sdr-psu config apply|undo|status`.
- Desktop edition (Pi 4): same warning, banner, row and API (identical web code); `config.txt` is not changed.
- `verify.sh` shows the power supply state.
### Unchanged
- Everything else.

## [1.2.3] and [1.2.3-desktop] - 2026-10-17 (PT) - Raspberry Pi 5 warm-reboot blank panel fixed; both editions
Found and confirmed on a real Raspberry Pi 5 (Ubuntu 24.04, linux-raspi 6.8, 5-inch Touch Display 2 in DISP0): the panel stayed blank after a warm reboot (backlight on, no picture, no touch) and only unplugging the power brought it back.
### Fixed
- **Blank panel after a warm reboot (Pi 5, Touch Display 2).** Root cause, found by switching units off one at a time (A/B tested twice on the hardware): `sdr-screen-final.service` wrote the backlight on the display's microcontroller (I2C address 0x45) about a second before the reboot (log line `final: reboot, backlight 10-0045 left on`). The warm reset then left that chip hung: the I2C controller timed out, 0x45 and the touch chip 0x5d vanished from the bus, the DSI panel never bound, and only a power cut recovered it. With that unit disabled, two warm reboots in a row came back normally. Not the cause (tested): the 1.2.2 `sdr-panel-off` hook (it was disabled during failing runs) and the bootloader EEPROM version (updating to 2025-12-08 changed nothing).
- **No shutdown-time I2C access to the display on a reboot.** `sdr-screen final` now acts only when the systemd job is poweroff/halt; on a reboot (or when it cannot tell) it does nothing and logs `final: reboot; backlight not touched`. Before, it wrote the backlight "on" on every reboot. The other two places that wrote the backlight while the box shuts down are closed too: `sdr-screen.service`'s `ExecStopPost` (`sdr-screen on --direct`) and the daemon's own exit step skip the write when the box is shutting down, and a reboot no longer wakes a sleeping screen through the backlight (a screen that was asleep stays dark during the reboot and `sdr-screen` turns it on at boot). Screens driven by `wlopm` / the black overlay (HDMI, desktop edition) are not I2C devices and behave as before.
- **A real power-off still turns the backlight off** as the last act (so "Safe to unplug when this screen goes dark" stays true). That one write happens only for poweroff/halt, never for a reboot. Risk to know about: a Pi that is powered off and then started again with its power button (not unplugged) keeps its display chip powered; if that ever shows a blank panel, run `sudo systemctl disable --now sdr-screen-final` (the backlight then stays lit after a shutdown, a reboot is unaffected).
### Removed (handheld)
- **`sdr-panel-off.service` and `/usr/local/sbin/sdr-panel-off`** (the 1.2.2 shutdown hook): it also wrote to the display chip right before a reboot, which is the very thing that must not happen. The installer deletes both on every install and upgrade, including when the unit had been disabled or masked by hand. The old script is removed first, so stopping a still-active unit cannot run the display-off write one more time. `fieldnote-display-setup --undo` still cleans up a leftover copy.
### Changed
- Upgrade from a Pi where `sdr-screen-final` was switched off by hand: the installer enables it again (the fixed version is safe on a reboot) and says so in its output.
- `sdr-panel-diag` (handheld): new "shutdown safety" section (is a `sdr-panel-off` hook still installed, is `sdr-screen-final` enabled). `verify.sh` shows the same on a Pi 5.
- Kept as is: `sdr-touch-reload.service`, the DSI port option, everything else.
- **Desktop edition**: the same `sdr-screen` fix and unit comments (identical code), version `1.2.3-desktop`. The desktop edition has no Pi 5 panel helpers and never had `sdr-panel-off`.

## [1.2.2] and [1.2.2-desktop] - 2026-10-16 (PT) - handheld gets the Raspberry Pi 5 work, desktop is version-aligned only
Found on a real Raspberry Pi 5 (Ubuntu 24.04, linux-raspi 6.8, 5-inch Touch Display 2 in the DISP0 connector, cage + Chromium snap).
### Added (handheld)
- **`--dsi-port 0|1`** for `fieldnote-display-setup` and `install.sh --display`. The Pi 5 has two DSI ports and the overlay defaults to DISP1; with the ribbon in DISP0 the panel stays dark unless the overlay line ends in `,dsi0`. The port cannot be detected from software, so `--dsi-port 0` writes `dtoverlay=vc4-kms-dsi-ili9881-5inch,dsi0`, `--dsi-port 1` (and no option on a fresh box) writes the plain default line. Re-running without the option keeps a `,dsi0` that is already in the managed block (also one edited in by hand), so an update never sends the panel back to DISP1. A Pi 4 ignores the option with a warning. `--undo` still restores `config.txt` byte for byte (tests added). On a Pi 5 the section filter `[pi5]` is now honoured like `[pi4]` is on a Pi 4.
- **`sdr-touch-reload.service`** (`/usr/local/sbin/sdr-touch-reload`), Pi 5 with the panel set up only. At boot the Goodix touch driver can look for the chip before the display's microcontroller has released it from reset (`Goodix-TS 10-005d ... -121`), and there is no touch. The unit waits for the chip and, only when no Goodix input device exists, reloads `goodix_ts` (up to 4 tries). A hand-made `goodix-reload.service` is moved to `/var/lib/sdr-station/`, not deleted. `sdr-touch-reload --check` reports the state.
- **`sdr-panel-off.service`** (`/usr/local/sbin/sdr-panel-off`), Pi 5 with the panel set up only: as the very last step before a reboot or power-off it writes the same two display-microcontroller registers as the shutdown hook of Raspberry Pi's own kernel driver (backlight PWM 0, LCD and touch reset bits 0). Ubuntu's linux-raspi kernel may not carry that hook. **A mitigation for the blank panel after a warm reboot, not a confirmed fix** (nothing publishes that this cures that symptom). Never fails a shutdown; disable with `sudo systemctl disable --now sdr-panel-off`.
- **`sdr-panel-diag`** (read-only; installed on every handheld): one report of the display chain (DRM connectors, backlight, I2C clients and the display microcontroller registers, touch devices, kernel messages, kiosk and service state, boot timing, the end of the previous boot). `--save NAME` keeps a copy in `/var/log/sdr-panel-diag/` to compare a good cold boot with a bad warm reboot.
- `/etc/modules-load.d/sdr-i2c-dev.conf` (Pi 5 with the panel only): `i2c-dev` at boot for the two helpers above.
- `verify.sh` shows the Pi 5 helper state.
### Changed (handheld)
- The handheld installer writes `handheld` to `/usr/local/lib/sdr-station/EDITION` (before, no file meant handheld). A box that runs Trace Desktop is not converted by accident: `install.sh` refuses with a message unless the full installer is run with `--force-edition` (never with `--upgrade`), the same rule the desktop installer has in the other direction. Converting also forgets the desktop HDMI display state (`DISPLAY_MODE=hdmi`, pointer shown) so the handheld kiosk forces touch and hides the pointer again.
- `fieldnote-display-setup --undo` also removes `sdr-touch-reload.service`, `sdr-panel-off.service` and the i2c-dev autoload file.
- The installer's Pi 5 helper step also runs on an over-the-air upgrade (units and scripts only; display settings are never rewritten by an upgrade).
### Not changed
- **Desktop edition**: version number only. The Pi 5 items above are about the DSI panel; the desktop edition drives an HDMI monitor.
- Nothing was changed for the warm-reboot blank panel beyond the mitigation above; the cause is not established (see the diagnostic helper).

## [1.2.1] and [1.2.1-desktop] - 2026-10-16 (PT) - both editions
### Removed
- **The per-unit license system.** The offline license key tool (`sdr-license`), the key check in the updater, the `/api/license` endpoints on the web service, the License card on More > Updates and the bundled license public key are gone. Updates install regardless of date. Update signature checking (Ed25519, public key in `config/stillwave-update.pub`) is unchanged. A key file left on a unit is simply ignored.
### Changed
- **Source released under the Apache License 2.0** (public repository `asearer-stillwave/stillwave-trace`). See `LICENSE` and `NOTICE` at the repository root.
- **Gain stepper no longer says AUTO twice.** The value pill already shows AUTO, so the button beside it now reads "Manual" while Auto is on (tapping it sets 38.6 dB) and "Auto" otherwise.
- **START screen** shows the line aircraft icon from the Map tab instead of the plane emoji.
- **Restarting / Rebooting screens**: "Back in about a minute." (and the shutdown line) use the theme mono font.
- **Map credit on the kiosk** ("OpenStreetMap contributors · Protomaps") is plain text, not a link. Tapping it navigated the kiosk away and blanked the page. Browsers on other devices keep the links.
### Fixed
- **Map module hardening.** The map library is loaded by `boot()` with a dynamic import instead of a static one at the top of the page script. A missing or broken map library now shows "The map library could not be loaded (...)" and the List view keeps working; before, the whole ADS-B page stayed on "LOADING...".
- **snapd is no longer turned off before Chromium is installed.** The 1.2.0 boot trim disabled snapd on a box whose first install had failed at the display step (no internet), so every retry could not install the Chromium snap. The installer now leaves snapd alone on any kiosk box (`--display`, a configured kiosk or an attached display) and turns it back on if it is off and Chromium is missing. `fieldnote-display-setup` also switches snapd on and waits for it to be seeded before `snap install chromium`. The Pi 5 first-boot script does the same.
- **Desktop: Raspberry Pi 5.** On HDMI the display setup recognises a Pi 5 (Ubuntu 24.04, cage + Chromium snap) instead of warning that it is written for a Pi 4; no manual snapd fixes are needed any more. Pi 4 is unchanged.

## [1.2.0] and [1.2.0-desktop] - 2026-10-13 (PT) - both editions
### Added
- **Text size** (More > Screen): Small, Normal, Large, Extra large. Scales the whole app, subtexts and tap targets included. Saved per screen/device; the 5" handheld defaults to Large, everything else to Normal.
- **Starts on Map / ADS-B, idle.** Boot no longer starts any radio job (`BOOT_MODE=idle` default in `/etc/sdr/mode.env`; `saved` or a mode name restores the old behaviour). The Map tab shows a big START button; the map (MapLibre + tiles) and the decoder only load once it is tapped.
- **Map gain stepper**: − / value / + / Auto on the map, docked above the altitude legend. Steps through the R820T gain table, saves `ADSB_GAIN` (`sdr-maps gain`, `POST /api/adsb/gain`) and restarts the running decoder; the aircraft count chip stays live so you can see what each step does.
- **Hotspot settings** on the Network page: name, password (Show, 8-63 characters), band 2.4 / 5 GHz, start hotspot at boot, Save. Applied through `sdr-net-mode ap-config` (NetworkManager hotspot and the hostapd fallback); a running hotspot restarts with the new settings.
- **iPhone home-screen web app**: web manifest, Trace icon (apple-touch-icon, 192/512 px), full-screen standalone launch, dark status bar.
- **grim bundled** (`vendor/grim_1.4.0+ds-2build2_arm64.deb`, Ubuntu 24.04): installed offline by the installer and by the OTA upgrade when missing.
### Changed
- **Finger-sized buttons on Listen** (FM, Airband, NOAA): gain and squelch chips, the 25 kHz / 8.33 step toggle, Edit / Save and preset tiles are at least 52 px tall at Normal (64 px on the handheld), and scale with Text size.
- **Faster boot**: `sdr-firstboot-done` is a timer (10-minute grace kept) instead of a 10-minute sleep that held multi-user.target ("boot not finished"); `sdr-net` and `sdr-bt-reconnect` run in the background instead of holding boot (~25 s and ~9 s); `sdr-mode` no longer waits for network-online. The installer and the OTA turn off cloud-init (`/etc/cloud/cloud-init.disabled`). snapd stays on while any snap app is installed: on Ubuntu the kiosk browser is the Chromium snap, which needs it.
- **Screenshot viewer**: no Download button on the kiosk screen itself (kept on phones and computers).
- **Screenshot fallback** (when grim cannot capture) renders the page the kiosk is showing, not Spectrum.
- **Theme**: ADS-B list rows in the mono font with a green selected row (was blue); Network page inputs, placeholders, "Switching now…" message and links in mono / accent green; Updates notes, install confirmation and Install-from-file text in mono; dark full-contrast labels on bright green buttons (also while busy); remaining legacy blue backgrounds moved to the brand palette.
### Fixed
- **iPhone white bar on the right.** The phone scale (zoom .86) sat on `<html>`; iOS Safari then painted the page background only over the zoomed width. Zoom now lives on `<body>` (phone scale x Text size), `<html>` stays full width and dark, and the tab frames clip to the screen.
- **Desktop: Bluetooth keyboard Shift (K830).** The kiosk tracks the physical Shift key itself and types the US shifted character whenever the browser delivers the unshifted one with Shift held (capitals and symbols); the launcher also exports the US XKB keymap to the browser.
- **Desktop: side-rail icons missing on the TV.** The HDMI kiosk no longer forces GPU rasterization (also removed from installed launchers by the OTA), and a short-landscape phone rule that hid tab icons no longer applies to the HDMI kiosk.
### Confirmed on hardware (1.1.0 / 1.1.0.1)
- 720p on the TV, HDMI audio, license key (handheld serial shown), update address short forms, screenshot viewer (Close / Download / Delete), remote access (Tailscale), More menu returns to the menu, SDR OFF pop-up style, SDR dongles page, "No radio detected" message.

## [1.1.0.1] and [1.1.0.1-desktop] - 2026-10-12 (PT) - both editions
Includes everything in 1.1.0.
### Fixed
- **Desktop 1.0.9 -> 1.1.0 update rolled back.** The post-install health check ran out of time (240 s in the 1.0.9 updater) before it printed anything. The cause was the boot-splash check: it listed the initramfs with `lsinitramfs`, which takes minutes on a busy Pi (here driving the 4K TV at 3840x2160@30). This came right after the new 720p EDID hook had rebuilt the initramfs. The same listing ran twice more inside install.sh, which is the ~15 min gap after "Saving a rollback copy".
  - `sdr-splash` now checks the initramfs in seconds: it decompresses it and looks for the theme file, falling back to `lsinitramfs` only if that fails. It caches the result by initrd size and mtime, so the health check is instant. An uncached listing gets at most 40 s during the health check and is then reported as "not checked" rather than failing.
  - `verify.sh --health` has a hard time budget (170 s by default; 30 s under the updater's limit from 1.1.0.1), so it always finishes with a HEALTH OK/FAILED line and the reason. It prints a `[health]` line with timings for each sub-check. The same checks still apply: web app and nginx up, the right version, pages and /api/strip load, boot splash files correct.
  - `sdr-update`: the health timeout is now 600 s (was 240 s), and each step logs its exit code and duration.
  - Desktop: the 720p EDID and the boot splash now share a single initramfs rebuild, done inside install.sh with its own progress line ("Boot splash + initramfs"), before the health check. `sdr-display-res` no longer rebuilds during an install.
- **More tab:** tapping More in the bottom nav always opens the More menu, never the last subpage you had open.

## [1.1.0] and [1.1.0-desktop] - 2026-10-12 (PT) - both editions
### Fixed
- **License status shows the Pi's own serial.** `sdr-license status` copied the key's fields over the status, so an R&D key showed serial 0000000000000000. `serial` is now always this Pi's serial. Unit keys report the key's serial separately (`key_serial`), and the Updates page shows "Pi serial … · key for …" or "· R&D key (any unit)".
- **Phone layout: no white bar on the right (iPhone Safari).** html/body clip horizontal overflow, html has the dark background, embedded pages (iframes) can't grow wider than the screen, and long code, notes and logs wrap.
- **Desktop: forced 720p on 4K TVs.** `video=` on the cmdline only set the console; cage picked the TV's preferred 3840x2160@30. Trace Desktop now installs a 720p-only EDID (`/lib/firmware/edid/trace-720p.bin`, HDMI audio kept) and adds `drm.edid_firmware=HDMI-A-1:edid/trace-720p.bin,HDMI-A-2:edid/trace-720p.bin` to cmdline.txt (installer, OTA, `sdr-display-res`). Idempotent; previous cmdline saved as `cmdline.txt.trace-pre-edid`. Undo: `sudo sdr-display-res edid-off && sudo reboot`, or remove the `drm.edid_firmware=…` word from cmdline.txt on the SD card's boot partition. Applies at the next reboot.
- **Bluetooth keyboard Shift (Logitech K830).** The kiosk service now sets an explicit US XKB keymap (`XKB_DEFAULT_LAYOUT=us`, model pc105) via the drop-in `fieldnote-kiosk.service.d/10-xkb.conf`. Both editions; applies at the next reboot.
### Changed
- **Screenshots open in an in-app viewer** (Close / Download / Delete, Esc or tap outside to close). The page never navigates away from Trace.
- **SDR OFF confirm pop-up restyled**: dark panel, green "// TURN SDR OFF" title, mono text, outlined CANCEL and orange TURN OFF.
- **SDR dongles page:** gap between the serial and "Not labeled"; the Over SSH commands are outlined chips instead of bright green.
- **Update source accepts short forms.** "192.168.1.50 8000", "192.168.1.50;8000", "192.168.1.50:8000" or an address without http:// are all saved as `http://192.168.1.50:8000/` (page, web API and `sdr-update set-url`).
### Confirmed on hardware (from 1.0.9)
- NOAA weather and airband audio, HDMI audio, SDR power OFF/ON, license key install, "No radio detected" message, SDR dongles page.
### On hold
- 978 MHz UAT, GPS (PA1010D), dual-dongle hardware test, demo video.

## [1.0.9] and [1.0.9-desktop] - 2026-10-11 (PT) - both editions
Handheld 1.0.9 and Trace Desktop 1.0.9-desktop now ship the same helper scripts and web app. Only the layout (portrait handheld / 720p landscape desktop), the display setup, and the edition constant in `sdr-update` differ.
### Fixed
- **NOAA weather and airband had no sound.** `fm_stream.sh` ran AM and narrow FM at `-s 12k` / `-s 12.5k` and resampled with `-r`, and that gave silence. They now sample at 24 kHz with no `-r` (`rtl_fm -M am|fm -s 24k -E dc`, the command that worked on hardware), and ffmpeg reads 24000 Hz to match. Broadcast FM is unchanged.
- Airband and NOAA now default to gain 40 with squelch off (the settings that were verified on hardware), instead of reusing the FM station gain (8).
- Handheld: the Reset pill on More no longer wraps ("Rese/t"). The airband "+ Save" row now stays hidden until you tap it.
### Added
- **Gain and squelch per band.** FM, airband and NOAA each keep their own setting, saved separately in `fm.env` (FM_GAIN, AIRBAND_GAIN / AIRBAND_SQUELCH, NOAA_GAIN / NOAA_SQUELCH). `sdr-fm-env` is still the only thing that writes that file. The Listen page has a Band settings card for each band: gain, plus squelch Off / Low / High for airband and NOAA. For FM, "Station" keeps each preset's own gain. Over SSH: `sudo sdr-listen band airband gain=40 squelch=0`.
- **LAX ATIS presets:** arrival 133.8 and departure 135.65, checked against the FAA Chart Supplement effective 1 Oct 2026. Units that already have saved presets get both added once.
- **SDR power (More > SDR power).** OFF stops Listen, Map, Scan and Spectrum and releases the dongle. Every mode page then shows "SDR is off · safe to swap antenna" and stays off through a reboot. ON resumes the last mode. Over SSH: `sudo sdr-mode off` / `sudo sdr-mode on`.
- **Screenshots (More > Screenshots).** Capture now or after a 5 s / 10 s delay. Files are saved on the Pi in `/var/lib/sdr/screenshots/` and can be viewed, downloaded and deleted from the web page. Captures use `grim` on the cage kiosk; without grim, Trace falls back to a headless page render. Over SSH: `sudo sdr-shot take 5`.
- **Offline license keys (Updates > License).** Keys are signed by Stillwave and checked on the box. A unit key is tied to the Pi serial; an R&D key unlocks any unit. Each key carries an updates-until date, and an update released after that date is refused. A key never stops the radio. With no key installed, updates still install (set `LICENSE_REQUIRED=1` in `/etc/sdr/license.env` to require one). Over SSH: `sudo sdr-license serial | status | install KEY`.
- **Dual NESDR Nano 3 support.** A dongle labeled STILLWAVE-ADSB runs the map full time (`sdr-adsb-dual.service`) while STILLWAVE-RADIO handles Listen, Scan and Spectrum. More > SDR dongles lists the dongles and labels one at a time (writes the EEPROM serial with `rtl_eeprom`). With one dongle, or two unlabeled ones, Trace runs exactly as before. Not yet tested on hardware (only one working Nano 3).
- **"No radio detected."** When no RTL-SDR is on USB, mode pages show a clear message with what to check, the status strip says "No radio", and switching modes reports it instead of failing silently.
- **Install progress over SSH by default.** `sudo sdr-update apply-file FILE` now follows the update and prints each step with a percentage until it finishes; no flag needed. Ctrl-C stops watching, but the update keeps going. `--no-follow` returns right away. The Updates page shows the percentage on both editions.
### Changed
- **Subtexts match the theme.** Page intros, card notes, status lines, list details, player notes and help text on every page (Network & Services, Audio, Listen, Updates, Map...) now use the same mono Static style as the More rows. "Tap play…" is a green hint, no longer a red error. The audio player is dark with green controls, and map stale rows and attribution use the theme colours.
- **Handheld: bigger small text.** On the 5" kiosk, help and subtext go from 15 to 17 px and labels from 13 to 15 px; the START-screen lines are larger too. Handheld stays portrait-only; desktop stays 720p landscape-only.
- Handheld gets the desktop 1.0.8.2 Updates fixes: the file picker has no type filter, uploads can be up to 400 MB (Flask + nginx), signature checks get more time, errors are clear, and install progress shows a percentage.
- Desktop gets the handheld 1.0.8.2 `sdr-fm-env` (safe `fm.env` writer + self-heal) for Listen, Tune, presets and Apply settings.
### Notes
- Upgrades never download packages. For real-screen captures run `sudo apt-get install -y grim` once while online; until then, Screenshots saves a page render.

## [1.0.8.2-desktop] - 2026-10-11 (PT)
### Changed
- **HDMI output is fixed at 720p (1280x720@60).** A Pi 4 can't drive the kiosk smoothly any higher, so the 1080p, 1440p and native options are gone from `sdr-display-res`, the installer, the Screen page and `/api/display/resolution`. When you upgrade, every HDMI kiosk is switched over: `video=HDMI-A-*` modes in `cmdline.txt` are rewritten to 1280x720@60 and `RESOLUTION=720p` is set in `/etc/sdr/display.env`. The change applies at the next reboot.
- **The desktop is always landscape.** Every page is laid out for a 1280x720 landscape screen and for desktop browsers. The kiosk never falls back to the phone or portrait layout.
- **Install progress.** `sdr-update apply` / `apply-file --foreground` now prints a numbered progress line for each step: reading the file, checking the signature, unpacking, each installer stage (including apt and snap activity), restarting services and the health check. The Updates page shows the same steps with a percentage.
### Fixed
- **Install from file on the Updates page.** The .ota file now shows up in the file picker, because the picker no longer filters by file type. Uploads can be up to 400 MB (Flask and nginx; the old limit was 100 MB), signature checks get more time, and the page shows clear errors for wrong files, files that are too big and timeouts.

## [1.0.8.1] - 2026-10-10 (PT)
### Changed
- **Map: compact follow card.** Tapping a plane now opens a small see-through card above the altitude legend instead of the near-full-screen panel. Nothing dims or tints the map. The card shows callsign and hex, altitude, speed, track, vert rate, squawk, distance and seen, plus FOLLOW and close.
- **FOLLOW turns solid green while following.**
- **The followed plane stays above the card.** The map pans it up so the card never covers it.
### Fixed
- Vert rate no longer gets cut off on iPhone.

## [Unreleased] / Planned
- **Handheld: always portrait.** Every handheld page will be locked to portrait.
- **Support for two Nano 3 SDRs** (dual-dongle setups).
- Desktop speed work beyond the 1.0.8 changes, if the Pi 4 still feels slow at 720p on real hardware.

### Decisions
- **Stay on Ubuntu 24.04.** A switch to Raspberry Pi OS Lite is not planned for now.

## On hold
- GPS: Adafruit Mini GPS PA1010D (chosen, $29.95, not ordered yet) for receiver position / Center on me.
- 978 MHz UAT (ADS-B on 978).
- Demo video (for Chad).
- Dual-dongle hardware test (needs a second working Nano 3).
- Raspberry Pi OS Lite switch (see the decision above).

---

## [1.0.8] and [1.0.8-desktop]: 2026-10-10 PT (both editions)
Handheld 1.0.8 and Trace Desktop 1.0.8-desktop ship from the same web app and helper scripts. The desktop OTA channel and edition guard are unchanged.

### Installer and networking (hotspot fixes)
- The Wi-Fi country (default US) is set first: `iw reg set`, `/etc/default/crda` and `cfg80211.ieee80211_regdom` on the kernel command line. `SDR_REGDOM=XX` changes it.
- The Imager / cloud-init netplan Wi-Fi is copied into a NetworkManager profile with its password kept. wlan0 moves to NetworkManager (netplan renderer) at the next reboot, and cloud-init stops rewriting the network config.
- NetworkManager is installed but not started mid-install (temporary policy-rc.d), so the SSH session stays up.
- SSH-safe installer: over SSH, the installer re-runs itself as a detached systemd unit and logs to `/var/log/trace-install.log`. Ctrl-C or a dropped session only stops the log view.
- Online preflight: the installer fails loudly before downloading anything if the box is offline.
- Each step leaves a done marker. `sudo bash install.sh --resume [--display hdmi]` skips the finished steps, and a failure prints this resume command.
- The display step runs before any network change. The snap Chromium download shows progress (`snap watch`).
- sdr-net-mode:
  - No hotspot while the installer runs, during the first boot after install (10 minutes), or while Wi-Fi is turned off.
  - The boot grace is 45 s (120 s on the first boot).
  - MODE=wifi is only recorded when a NetworkManager home profile exists.
  - `netplan-wpa-*` is stopped when NetworkManager claims wlan0.
- While the fallback hotspot is up and idle (no clients), home Wi-Fi is retried every 4 minutes (`sdr-net-retry.timer`).

### UI
- Single-load app: `/` is a shell with the status strip and nav. Each tab is a same-origin frame that stays loaded, so tab switches are instant with no page reload, and the map keeps its instance. There is one shared `/api/strip` loop, one power sheet and one screen poller. Old URLs open inside the shell.
- Nav order: **Listen, Map, Scan, Spectrum, More**. Detect is now **Scan**; `/detect` redirects to it. Phones and the kiosk land on **Spectrum**.
- The SDR MODE row is gone. Each tab belongs to one dongle mode. If the dongle is in another mode, the tab shows a START screen: the mode line, a big START button and a short note. Opening a tab never switches modes.
- Full-page ADS-B map with floating pills:
  - count chip, MAP/LIST and fullscreen (hides the strip and nav)
  - Center LAX, Center me, Rings and Labels
  - a slim altitude legend
- Listen page: FM / **Airband** / **NOAA**.
  - Airband: AM 118-137 MHz with 25 / 8.33 kHz steps and squelch (off / low / high). Presets can be saved and deleted; the defaults are the LAX FAA list (Tower N/S/Heli, Ground N/S/W, Clearance, ATIS arr/dep, SoCal Approach x3).
  - NOAA: the 7 weather channels (narrow FM).
  - The status strip shows AIRBAND or NOAA with the station name.
- Scan: one Settings sheet and a bigger graph. The list is sorted by frequency and refreshes every 5 s. HOLD / RESUME keeps the list frozen until tapped. Each row has a LISTEN button that opens Listen with the right demod: 88-108 MHz wideband FM, 118-137 MHz AM, anything else narrow FM.
- Spectrum's marker Listen button uses the same demod rule.
- More: Wi-Fi ON/OFF toggle (warns that phones lose the connection; the hotspot fallback respects it) and **Reset SDR USB** with a confirm dialog (USB unbind/rebind or usbreset, then the current mode restarts).
- The WONDERBOOM pairing blurb is removed from the Audio page; the Bluetooth controls stay.
- Responsive layout:
  - Phones are scaled to about 86%, like the 5" kiosk, with touch targets of 40 px or more.
  - iPad and desktop get a side rail from 760 px wide at every width, which fixes the 1.0.7 gap where the menu vanished.
  - The 5" kiosk keeps its own look.
- Subtext colors that didn't match the theme are fixed (Static grey). The glow is unchanged.

### Radio
- `fm_stream.sh` reads `DEMOD` (wfm / am / nfm) and `SQUELCH` from fm.env. `sdr-listen` tunes and stores airband / NOAA presets (`/etc/sdr/listen-presets.json`). FM presets and tuning always reset to wideband FM.
- Boot default: the dongle starts in Spectrum mode at 98.7 MHz (`BOOT_MODE=saved` in mode.env restores the old behavior).

### Performance and display
- The map zoom-lag fix from 1.0.7-desktop is ported to handheld.
- The desktop dashboard is removed (desktop). `/dashboard` redirects to `/` and keeps the kiosk flags.
- Desktop: HDMI defaults to 1080p (KMS `video=` on the kernel command line). 1440p and native are options via `sudo sdr-display-res` or the Screen page. They apply at the next reboot, and an upgraded HDMI kiosk gets 1080p once.
- Desktop: the audio output choice is HDMI / headphone jack / Bluetooth / phone stream (`AUDIO_SINK`, `sdr-bt sink`). The default is HDMI when detected, else the 3.5 mm jack.

## [1.0.7-desktop]: 2026-10-09 (separate DESKTOP edition)
A separate edition for an HDMI monitor (first box: Pi 4 "stillwaveradio", 27" 2560x1440, Ubuntu Server 24.04). The handheld 1.0.x line never receives it.
### Added
- Edition marker `EDITION=desktop` and VERSION `1.0.7-desktop`. Packages are product `stillwave-trace-desktop`, channel `desktop`. The updater refuses the other edition in both directions, and the desktop installer refuses to install over a handheld box (`--force-edition` overrides).
- Widescreen `/dashboard`: ADS-B map, FM, spectrum and aircraft list, with a left rail. Phones get the normal pages.
- HDMI kiosk via `install.sh --display hdmi`:
  - no DSI overlay; `vc4-kms-v3d` and `disable_overscan=1` under `[all]`
  - cage + snap Chromium at the monitor's native mode
  - pointer visible; on-screen keyboard only when a touch screen is detected
  - screen off via wlopm (DPMS); no brightness slider
- Landscape 16:9 boot/shutdown splash (B2 radar art).
### Changed
- Map zoom-lag fix: no data updates mid-gesture, rings recomputed on zoomend, lighter map sources. Same look.
### Known issue
- First fresh install (2026-10-10): the box fell back to the hotspot and the display step didn't finish. Fixes are listed under Planned (installer and networking).

## [1.0.6]: 2026-10-09 12:21-12:35 PT
### Fixed
- Kiosk mouse pointer actually hidden:
  - over-the-air updates now apply the blank-pointer drop-in;
  - the blank cursor theme is also copied where snap Chromium can read it (`/var/snap/chromium/common/fieldnote-cursor`) and is set through XCURSOR_PATH / XCURSOR_THEME, with an ExecStartPre helper.
  - Needs a reboot to take effect.
### Added
- On-screen keyboard for the kiosk (`kbd.js`):
  - letters / numbers / symbols layouts, Shift and Caps Lock, Del with repeat, Space, Done;
  - number pad for numeric fields; keeps the field visible above the keyboard;
  - 70 px keys, Night Ops style; phones unaffected.

## [1.0.5]: 2026-10-08 00:09-00:25 PT
### Added
- Boot and shutdown splash: Plymouth theme `stillwave-trace` with B2 radar-sweep art; `sdr-splash` and `sdr-boot-setup --splash on|off|status|check`.
- The kiosk shutdown screen uses the same art.
### Changed / Fixed
- Font fixes from the fonts-105 review, folded into `fieldnote.css`.

## [1.0.4]: 2026-10-07 23:42 PT
### Changed
- Radio dial shows frequencies and preset ticks only, with the tuned station's name above; preset chips show call sign + MHz.
- More page: mono caps row titles, one size of secondary text.
### Added
- ADS-B Rings panel: off/2/3/4/6 rings, spacing auto/1/2.5/5/10 NM. Saved on the Pi (`/etc/sdr/adsb.env`) and shared by the kiosk and phones. The default LAX view is 3 rings 5 NM apart.

## [1.0.3]: 2026-10-07 23:02 PT
### Added
- v5 brand UI (Night Ops): bundled Anton and JetBrains Mono fonts (OFL), FM dial, zoom-scaled range rings, 8-band altitude scale and legend.
### Changed
- Bootloader: WAKE_ON_GPIO=0 and POWER_OFF_ON_HALT=1.

## [1.0.2]: 2026-10-07 ~21:32 PT
### Added
- `sdr-screen`: kiosk screen off/on with timeout, wake on touch; web UI and API.
- `sdr-boot-setup` (EEPROM settings) and a shutdown screen.
### Changed
- Screen off is the first item in the Power sheet and also a row on More. The moon button was removed from the status strip (it clipped the Wi-Fi name).
### Removed
- GPIO power button (dropped before release).

## [1.0.1]: by 2026-10-07 (after the 16:39 PT "pre-ota" backup)
### Added
- Over-the-air updates: `sdr-update` with Ed25519-signed packages (key id 1351694b8ccd620d), `latest.json`, "Install from file" (`.ota`), automatic rollback with a health check (`verify.sh --health`).
- VERSION file; Updates page.

## Pre-1.0 milestones (Fieldnote / sdr-station), 2026-10-06 to 2026-10-07
Dates come from backup timestamps (deploy zips from 2026-10-06 23:16 PT; source backups "pre-tabs" 07:40, "pre-trace" 15:43, "pre-ota" 16:39, "pre-screen" 20:13 PT on 2026-10-07).
- Ubuntu 24.04 on Raspberry Pi 4 fixes: DVB module blacklist, NetworkManager owning wlan0, eth0 kept as a back door.
- Wi-Fi / hotspot switching (`sdr-net-mode`): home Wi-Fi or Trace hotspot at 10.42.0.1, restored at boot, with a fallback hotspot when home Wi-Fi isn't reachable.
- Kiosk on the Raspberry Pi Touch Display 2 (5", 720x1280 portrait): `fieldnote-display-setup` (section-aware `config.txt`, cage + snap Chromium on Ubuntu Server).
- ADS-B with an offline LA/LAX map (MapLibre + PMTiles, vendored; works without internet), receiver position.
- Dongle modes: FM / Spectrum + waterfall / Detect / ADS-B, one owner at a time.
- Bluetooth speaker output (A2DP, PipeWire), e.g. UE WONDERBOOM 4.
- Status strip + bottom tab bar (backup "pre-tabs", 2026-10-07 07:40 PT).
- Power menu (reboot / shut down) from the web UI.
- Renamed Quietline Fieldnote to **Stillwave Trace** (backup "pre-trace", 2026-10-07 15:43 PT). Internal `fieldnote-*` / `sdr-*` names were kept so installed Pis upgrade in place.

## Baseline: "Neo SDR station" (original package provided by Searer)
- Ubuntu 24.04 box that tunes an RTL-SDR FM station, encodes it to MP3 and serves it on Icecast, with a phone-friendly web UI.
- `install.sh` installs rtl-sdr, sox, ffmpeg, Icecast2, Flask, nginx, NetworkManager, hostapd and dnsmasq. It blacklists the DVB modules and writes `/etc/sdr/fm.env` and `stations.conf`. A Wi-Fi hotspot needs an AP-capable adapter.
