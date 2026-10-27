# Changelog: Stillwave Trace

Trace was earlier called Quietline Fieldnote; before that it was the "Neo SDR station" package (`sdr-station`).
Format: [Keep a Changelog](https://keepachangelog.com/). Newest first. Times are Pacific (PT).
Sources: build logs (`PROGRESS-*.md`), READMEs, VERSION files and the timestamped backups in `/workspace/sdr/backup/`.
Before 1.0.2 there are no per-version build logs, so those dates are taken from backup timestamps and say "by".

## [1.3.2] and [1.3.2-desktop] - 2026-10-26 (PT) - Airport follows the map, Wi-Fi auto-join, Scan removed, AIS fixes (13 items); both editions
### Added
- **Airport button follows the map.** `ICAO ▾` replaces CENTER LAX (and the KLAX pill). It shows the airport nearest the map center. Tap the code to center on it (with two radios this opens airport focus). Tap ▾ for nearby airports with distances in nm. CENTER ME stays. US airports come from the FAA station bank, Europe from OurAirports (public domain, bundled `web/airports_eu.json`: 466 scheduled-service airports). Frequencies are never invented. With no published tower, ground, approach or ATIS frequencies, Quick Tune says so and stays off. API: `GET /api/airports?lat=&lon=` (web/airports.py).
- **Quick Tune** header `ICAO ▾ · follows the map`, with short tabs TWR / GND / APP / ATIS. Bearing sectors are kept only when every frequency of that kind has one (KLAX: APP NW / SE / NE). If some do and some don't (KSBA, KBUR), that kind is numbered (APP 1, APP 2…). A raw range like `APP 151-329` never shows.
- **Auto-join known Wi‑Fi** (Settings › Network, on by default). At boot Trace scans once and joins a saved network heard at about −67 dBm (3 bars) or better. Otherwise it starts the TRACE-XXXX hotspot, and any failure also ends on the hotspot. While auto-joined, `sdr-net-watch.service` brings the hotspot back after 30 s without Wi‑Fi. Saved networks are listed with bars, dBm and JOINED / TOO WEAK / NOT SEEN, plus FORGET (`/api/net/wifi-auto`). Passwords are never shown. A unit still on a stock hostname becomes `trace-xxxx` (`http://trace-xxxx.local/`, avahi enabled).
- **One top chip per SDR with live status**: Live, Tuning… (amber), No signal, Reconnecting…, Switching… and No radio (red). "No signal" is for NOAA only: the weather channel is a continuous broadcast, so no decoded audio for 20 s means no signal. Airband silence is normal and FM with no carrier is hiss, so neither is flagged.
- **Aircraft icons by type**: heavy, airliner, regional, bizjet, turboprop, light, helicopter (lighter rotor) and other. Drawn for Trace. The type comes from an ICAO type table (`web/aircraft_types.json`), with the ADS‑B emitter category as the fallback.
- **Boat hull icons** (option B). The hull points along the heading (or course), with a wake mark when moving.
- **Gear panel APPLY / CANCEL** for FM and Airband. Changed options are striped amber, with "● N changes pending · radio not retuned yet". NOAA still saves on tap.
- **Download maps**: an SD card bar (system / maps / downloading / free), short labels, one Download button per pack, a "Won't fit" warning and a "Too big" tag before you tap, and a disabled `USA street level · z14 · ~8.8 GB · coming soon` row.
### Changed
- **FM filters**: high-pass 50 / 60 / 70 / 80 Hz (default 50), low-pass 6K / 7K / 8K / 9K (default 8000). Saved values are migrated on upgrade (`sdr-listen migrate`): 8500 becomes 8000, and anything else snaps to the nearest option.
- **FM presets** use the Airband / NOAA preset card style.
- **AIS install** (`sdr-ais-fix`): runs apt-get update, then `apt-get --fix-broken install`, then checks for 600 MB free on / and /tmp with a clear message, then installs.
### Removed
- **Scan / detect.** The page, `sdr-scan`, `sdr-detect.service` and `/api/scan` are gone. The upgrade stops, disables and removes sdr-detect. A saved `MODE=detect` falls back to spectrum. `/scan` and `/detect` redirect to Spectrum. Spectrum tap-to-listen and `/api/scope` stay.
### Fixed
- **AIS community feed off.** AIS-catcher v0.70 turns on sharing to aiscatcher.org (185.77.96.227:4242) by default when outputs are configured. `ais_run.sh` now passes `-X off`. Tested on the v0.70 binary: without the flag it logs "TCP feed … 185.77.96.227 … connected"; with it, "Community feed sharing disabled." 1.3.1 units sent AIS data to that feed.
- **Listen strip** now shows what the Pi itself plays. With AUDIO_OUT=speaker, fm_stream.sh plays through PipeWire on the Pi with no browser stream, and the strip only looked at the browser player. Stop also stops the Pi.
- **Desktop XL**: the boats toggle no longer clips or overlaps the altitude legend, and the Quick Tune panel no longer covers the MAP / LIST pill.

## [1.3.1] and [1.3.1-desktop] - 2026-10-25 (PT) - Splash on Pi OS, AIS boats, map regions, audio filters (12 items); both editions
### Added
- **AIS boats on the map.** Give a dongle the new **Boats · AIS** job (Settings › Radios). The unit then builds the AIS-catcher decoder (v0.70, pinned commit 8833c64, GPL-3.0) from source, which needs internet once (`sudo sdr-ais-fix`). After that `sdr-ais.service` decodes both AIS channels on that dongle and serves them on 127.0.0.1:8100 only. The map shows boats as dots colored by type (cargo, tanker, passenger, fishing, tug, sail, other), with a 6‑minute course line and names cut to 14 characters with "…". Tap a boat for its details card. An **All / Aircraft / Boats** button appears once a boat has been heard. Boats fade after 3 min and drop off after 10 min (`GET /api/boats`). AIS needs its own dongle. With map + AIS, Listen shares the map dongle.
- **Map regions from a list** (Settings › Maps). There is a built-in region catalog (SoCal overview, San Diego, SF Bay, Seattle, NYC, Boston, Miami, Houston, Las Vegas) in street and overview packs. On Wi‑Fi a region downloads straight from the latest Protomaps build (`sdr-maps region`). Sizes come from a dry run, so they are shown as estimates (~). On the hotspot or with no internet, Get is disabled and a banner explains why.
- **FM gear**: audio rate, high-pass and low-pass. New FM presets default to 48000 / 50 / 8500 Hz.
- **Airband gear**: high-pass and low-pass, default 200 / 3400 Hz. NOAA keeps its fixed 200–3400 Hz filter.
- **NOAA**: a big frequency readout with −/+ that steps WX1…WX7.
- **Settings › System**: Services and Logs moved here from Network.
### Changed
- **Quick Tune labels come from the FAA remarks.** Approach and departure buttons read, for example, `APP NE`, `DEP SE`, `APP RWY 11`, `CLASS B`, or `APP 1` / `APP 2` when nothing else tells them apart.
- **Station Bank**: compact rows. The city line is hidden when it is the city you picked.
- **Aircraft icons** stay Normal size at Large/XL text size. Only the labels scale.
- **SPEAKER chip** shows the connected speaker's name, cut to 12 characters with "…".
- **The unit always boots into its TRACE-XXXX hotspot** (WPA2). Units that still have the old auto-generated hotspot password move once to the default password (see the manual). A hotspot name or password you set yourself is kept. Boot also turns the Wi‑Fi radio on.
### Fixed
- **Boot splash on Raspberry Pi OS.** `sdr-splash` now finds the initramfs the firmware really loads (`initramfs_2712` on Pi 5, `initramfs8` on Pi 4, or an explicit `initramfs` line) and sets `auto_initramfs=1`. It installs plymouth offline from bundled trixie arm64 packages (SHA256-checked), with apt as a fallback. A skipped splash is no longer silent: `verify.sh` prints `HEALTH WARN: boot splash FAILED`, and the update result says `Boot splash FAILED: …`. It does not roll back the update. Backups are kept.
- `sdr-scan` stops only the radio service when two dongles are really dual (not with map + AIS).

## [1.3.0] and [1.3.0-desktop] - 2026-10-25 (PT) - Listen, Scan, Settings and Network redesign (22 items); both editions
### Changed
- **Listen** rebuilt to the 1.3 mockups. A sticky "now playing" strip always shows what is actually tuned (it still says `AIRBAND · 128.500` while you look at the FM tab), with a LIVE light, a talking/quiet indicator, signal bars and Stop/Play. The audio player is hidden but playback continues.
- Each band has a tuner card: a big readout, −/+ buttons and a dial. −/+ snaps to the nearest valid channel (FM 0.2 MHz; airband 25 kHz or 8.33 kHz, picked with STEP). Preset dots on the dial tune when tapped. When several dots sit close together, a tap opens a small list of the nearby presets.
- The band settings moved behind a gear button labeled with the current values (for example `30 · LOW`, or `GAIN AUTO` on FM). Presets sit right under the tuner, with STATION BANK and EDIT PRESETS buttons. "+ Save" for airband is now in Edit mode.
- NOAA cards show the WX channel number.
- **Scan**: one top row with Frequency ▾ (preset picker), ⚙ (advanced fields) and HOLD. HOLD now really stops the SDR and freezes the spectrum (new `POST /api/scope/hold`). It shows an "On hold" badge, and RESUME restarts the scan. At XL text size, HOLD moves to its own row.
- **"More" is now "Settings"** everywhere. The tab has a gear icon; the other tab icons are unchanged. Old `/more` links redirect to `/settings`.
- The top Audio chip reads `SPEAKER ✓` or `SPEAKER OFF` (no brand name).
- **Network**: the Wi‑Fi on/off switch moved here from Settings (where Wi‑Fi is now a link). The address is shown once, and a failed switch shows on one line, `Couldn't join · Details ›`. Shorter notes.
- **Station bank**: the STATE ▾ and CITY ▾ dropdowns replace the state grid and city buttons, and the last state is remembered. "About the data ›" folds open. At Large and XL text size the dropdowns stack.
- **New preset** scrolls to the top and puts the cursor in Name.
- Maps render at the screen's real pixel density, so they're sharper on the Pi screen and at XL.
- **Boot and shutdown screens**: boot messages appear in the Trace style. Shutdown shows "SAFE TO UNPLUG WHEN DARK" with a 5 s countdown (new `sdr-shutdown-screen` service, poweroff only, timed before the existing backlight step; there are no new display-MCU writes).
### Fixed
- **Hotspot security**: the "Hotspot" profile is now pinned to WPA2 (wpa-psk, RSN, CCMP, PMF off) on both NetworkManager paths, so iPhones and Macs join reliably. If the hotspot fails at boot, it retries on 2.4 GHz WPA2.
- **A unique hotspot name per unit**: the default is `TRACE-XXXX`, taken from the unit serial. A unit that still uses the old default "Trace" gets renamed the next time the hotspot starts, and its password is kept. Names you chose yourself are not changed.

## [1.2.10] and [1.2.10-desktop] - 2026-10-25 (PT) - On-screen keyboard no longer covers the field; both editions
### Fixed
- **The on-screen keyboard no longer hides the field you are typing in** (found by Searer on the Pi 5: More › Updates › Update source). Pages run inside the app frame, where a frame style overrode the keyboard's bottom space, so the page could not scroll up far enough. Now, when the keyboard opens, the page (and any scrolling sheet, such as New preset) gets bottom space equal to the keyboard height, and the field and its label scroll into view above the keyboard with a 16 px margin. Moving to another field while the keyboard is open, or switching to the number pad, does the same. The space is removed when the keyboard closes. Applies to every text field: Update source, Content source, Wi‑Fi password, hotspot, new preset, station search.
### Changed
- **Install from file** now asks for the `.tar.gz` plus its `.sig` (the update zips no longer include an `.ota`). An older `.ota` file is still accepted.

## [1.2.9] and [1.2.9-desktop] - 2026-10-24 (PT) - Brand text pass, mono ALL CAPS body, short station names; both editions
### Changed
- **Body text is now mono and ALL CAPS** everywhere (Searer's pick). Anton headlines are unchanged. Text you type (inputs, the on-screen keyboard), logs and the hotspot password keep their real case. Wi‑Fi names in lists show in caps, but tapping one fills in the exact name.
- **Short station names** so nothing wraps on the 5" screen. All names are one line, and long ones end in "…":
  - FM rows: `KXLU  88.9`, with the city on line 2 (kW dropped).
  - Airports: `KSDM  BROWN`. The ICAO code plus a short name of at most 14 characters, without Intl/Airport/Regional/Municipal/Field and similar words.
  - Airband rows: `TWR 119.200`, using TWR, GND, CLR, APP, ATIS, CTAF and UNIC, always with 3 decimals.
  - Presets, the dial label and the map's airport frequencies: `KLAX TWR N`, `SOCAL APP`, `KBUR ATIS` (at most 14 characters).
  - The airport page note is now `City · Center ZLA`.
- The short names are computed when the bank is built (`airport.short` and `afreq.short`, bank format 2, `stationnames.py`). Station banks built before 1.2.9 still work, because the box computes the same names on the fly.
- **Station bank text matches the brand.** Group labels are mono HUD labels with a `// ` prefix. Row titles and tags are mono uppercase, and the breadcrumb is a HUD line. The Near me "Home" label is `// HOME`.
- **Name tidy:** "Lee'S Summit" is now "Lee's Summit", "Mcallen" is "McAllen", "Field Of Dreams" is "Field of Dreams" and "M C R" is "MCR". FAA shorthand is spelled out: Intl→International, Muni→Municipal, Rgnl→Regional, Fld→Field, Cmplx→Complex, Arr/Dep→Arrival/Departure, Socal→SoCal.
- More and Screenshots titles are in Paper. The "saved for FM" tag uses a Static outline instead of amber (amber is for warnings). "MHZ AM", the Reset pill and the text-size options are uppercase HUD style. One-word option buttons (gain STATION, segment buttons) never break mid-word.

## [1.2.8] and [1.2.8-desktop] - 2026-10-24 (PT) - ADS-B decoder check (Raspberry Pi OS), OS updates on fresh install, Tuner removed; both editions
### Fixed
- **ADS-B on Raspberry Pi OS:** its `readsb` package (3.14.1630+git20240609) is built without RTL-SDR support ("Unknown device type: rtlsdr"). sdr-adsb restart-looped and Start map flipped back to FM. The installer now checks that the decoder really supports rtlsdr. If not, the new **`sdr-adsb-fix`** builds upstream readsb **v3.16.18** (commit 9460652, GPL-3.0, binary only, readsb.service stays masked) with `RTLSDR=yes` into `/usr/local/bin`. Needs internet once.
- `adsb_run.sh` looks in `/usr/local/bin` first and skips a readsb without rtlsdr. With no capable decoder it logs a clear error with the fix (`sudo sdr-adsb-fix`, then `sudo sdr-mode adsb`) instead of starting it. The `sdr-mode` hint says the same.
- Handheld XL, Airband/NOAA tuner: the "+" step button no longer pokes past the right edge. The frequency may shrink, and "MHz AM" moves under it.
### Added
- **OS updates on a fresh install:** `apt-get full-upgrade` (non-interactive, keeps config files) before the packages. It runs once per install and never during an over-the-air update. Skip with `--no-os-upgrade`. If a new kernel/firmware lands, the installer says so and it starts at the final reboot (no mid-install reboot).
### Removed
- **Tuner page** (More › Tuner, `/advanced`). The Station bank and Scan replace it. `/advanced` redirects to Listen, like `/radio`. Installs and upgrades delete the old page. The `/api/scan` endpoint and `sdr-scan` helper stay for now; no page uses them any more.

## [1.2.7] and [1.2.7-desktop] - 2026-10-24 (PT) - Navigation: back buttons go where you came from, Station bank from Listen; both editions
### Added
- **‹ MORE back button** at the top of all nine More pages: Tuner, Radio roles, Network, Audio, Screen, Screenshots, Updates, Download maps, About & licenses. It is styled like ‹ FM RADIO and returns to the More menu.
- **STATION BANK ›** on Listen: in the FM Stations card next to EDIT PRESETS ›, which opens the FM bank, and in the Airband Presets card next to Edit / + Save, which opens the Airband bank. At Large the buttons share the title's line; at XL on the handheld they move to their own row and never wrap.
### Changed
- **Back buttons follow where you came from:** opened from More (`?from=more`), Preset settings and the Station bank show **‹ MORE** and return to More. Opened from Listen they keep **‹ FM RADIO** and **‹ LISTEN**.
- **`/radio` now redirects to `/listen`.** The old stand-alone FM page had no links to it in the app. `radio.html` itself is still installed for the Icecast page on port 8000.
### Fixed
- The handheld `screen.html` had a comment that wrongly said "desktop edition" on the HDMI resolution card. Comment only.
- Update zips now hold only `latest.json`, the `.tar.gz` and its `.sig`; the `.ota` is no longer included, so each zip stays under 25 MB.

## [1.2.6] and [1.2.6-desktop] - 2026-10-24 (PT) - Download maps, US station bank, New preset; both editions
### Added
- **More › Download maps:** browse regions (World › North America › United States › state › metro), see each map's size, tap **Get**. Downloads run in the background (Pause / Resume / Cancel, a waiting queue) and **resume where they stopped** after a dropped connection or Pause. Each map is checked against the **signed map list** (Ed25519, the Stillwave update key) and its **sha256** (plus its own signature file) before it is used. **1 GB is always kept free**; a map that would eat into it is refused with a clear message. **My maps** lists the built-in LA map and every download with **View** (opens the map there) and **Delete** (tap twice). With no internet the last map list is shown and the maps on the box keep working.
- **Downloaded regions on the ADS-B map:** every installed pack is drawn in addition to the built-in LA map (layers merged so overlapping files never hide each other's roads or labels), and the pan limit grows to cover them.
- **CONTENT_URL** (More › Download maps › Content source, or `sudo sdr-content set-url URL`, stored in `/etc/sdr/update.env`): one base address for map packs, the station bank and updates (`updates/handheld/` or `updates/desktop/`, used only when `UPDATE_URL` is empty, so serving from a Mac still works). Point it at a home Raspberry Pi now and Cloudflare R2 later.
- **More › Stations (US station bank, offline):** 11,373 FCC FM stations and 7,538 FAA airports with 15,845 airband frequencies (Tower, Ground, Clearance, ATIS, Approach/Departure, CTAF, UNICOM). Browse **State › City** (FM) or **State › Airport** (airband), **search** by call sign, airport code (BUR or KBUR), city or frequency, **Near me** by home ZIP code or the map's home position (no GPS yet). Every row has **▶ Tune** and **＋ Preset**; airports have **Focus on map** and **Add all to presets**. Bundled (2.2 MB, FAA cycle 2026-10-01) and installed by the package.
- **Airport focus for any US airport:** `/api/airports?id=KBUR` builds the airport from the bank, with FAA runway headings (APT_RWY true alignment) for the approach rings and cleaned-up Approach names (e.g. "SoCal Approach 225-044 LAX"). The Map's KLAX focus now uses the bank too; the 1.2.5 KLAX file stays as the fallback.
- **About › Station bank:** counts, FAA cycle and next cycle, **Update station bank** (signed manifest + sha256 from CONTENT_URL), and the FCC / FAA / Census credit with **Receive only, not for navigation**.
- **Preset settings › ＋ NEW PRESET** (next to ‹ FM RADIO): FM or Airband, name, frequency, gain (FM), Save / Cancel. FM saves to the preset list without retuning; Airband saves to Listen › Airband presets (airband gain stays per band). Stations' **＋ Preset** opens it prefilled.
- `sdr-content` (map packs + station bank helper), `web/bank.py`; build tools `tools/build_station_bank.py`, `tools/content/{build_map_pack.py,publish_content.py,regions.json}` and the home server kit `tools/content/server/` (Pi OS Lite nginx setup, R2 upload with rclone).
### Fixed
- KLAX approach rings used magnetic-ish headings (69/249); the bank's true runway alignment (83/263) matches ADS-B track, so rings now catch aircraft on the 24/25 finals reliably.
- Tower quick-tune picked the helicopter frequency first at LAX; helicopter frequencies now sort last.

## [1.2.5] and [1.2.5-desktop] - 2026-10-23 (PT) - FM page fixes, two radios at once, aircraft models; both editions
### Added
- **Listen › FM: EDIT PRESETS ›** pill on the FM stations card opens Preset settings; **‹ FM RADIO** at the top of Preset settings goes back to Listen › FM.
- **Radio roles** (More › Radio roles, was "SDR dongles"): pick a job for each dongle by serial number: Map · 1090 (SDR 1), Airband (SDR 2) or Spare. Identify (unplug test), Save roles, Swap. Saved in `/etc/sdr/sdr-roles.json`; the 1.0.9 STILLWAVE-ADSB / STILLWAVE-RADIO labels still work. Numeric serials (e.g. 00000001) are looked up to the right device number. Duplicate serials are detected and the box stays on one dongle.
- **Two radios at once:** with roles saved and both dongles plugged in, the ADS-B map runs on SDR 1 while SDR 2 plays airband (or Scan / Spectrum), using the 1.0.9 dual-dongle services.
- **Map listen strip** (two radios only): bottom bar on the map with what SDR 2 plays, a signal meter and QUIET / TALKING from the squelch (new `sdr-level` pass-through meter on AM / narrow FM; broadcast FM unchanged). ▴ opens a quick-tune sheet (Tower / Ground / Approach / ATIS + squelch) without leaving the map.
- **Airport focus (KLAX):** tap the LAX label or the KLAX pill: the map zooms in, a chooser tunes Tower / Ground / Approach / ATIS, and planes on approach are ringed. Frequencies in `config/airports.json` from FAA Chart Supplement data (AOPA / airnav, checked 2026-10-23); SoCal Approach 124.5 / 124.9 / 128.5 by sector.
- **Header chip** with two radios: "ADS-B ✓ / Airband ✓"; amber with ✕ when a saved radio is missing, plus a map notice ("Airband radio missing · map still live"). With one dongle and no roles saved, nothing changes.
- **Aircraft models:** offline lookup (Mictronics aircraft database, ODC-By 1.0, via tar1090-db; bundled `vendor/aircraft-db/aircraft.csv.gz`, built into `/var/lib/sdr/aircraft/aircraft.sqlite` by `sdr-aircraft-db`). `/api/adsb` adds `reg`, `type`, `model`; the map card shows "N12345 · Boeing 737-800 · B738" and the List view shows the model under the flight; "Unknown type" when not listed.
- **More › About & licenses:** map, aircraft data (ODC-By credit) and frequency sources, plus **Update aircraft database** (needs internet, ~8 MB).
### Fixed
- Preset settings form no longer runs off the screen at Large / Extra large text on the handheld (one column on narrow screens, inputs shrink to fit).
- Listen: the AIRBAND tab no longer breaks mid-word at Extra large.

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
