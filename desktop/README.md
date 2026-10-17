# Stillwave Trace DESKTOP edition (1.0.7-desktop)

> Licensed under the Apache License 2.0 (see `LICENSE` and `NOTICE` at the repository root). 1.2.1 removed the per-unit license system.
> The offline map file `maps/la.pmtiles` is not stored in this repository (it is a 55 MB build artifact). Create it on the Pi with `sudo sdr-maps fetch` (needs internet once); until then the ADS-B map uses its built-in outline.

Separate build of Trace for an HDMI monitor (first box: Pi 4 "stillwaveradio", 27" 2560x1440, Ubuntu Server 24.04 LTS 64-bit).
Handheld Trace (5" touch, 1.0.x) and Desktop never exchange updates: this tree has `EDITION` = desktop, versions end in
`-desktop`, packages say product `stillwave-trace-desktop` / channel `desktop`, and `sdr-update` refuses the other edition.

Fresh install (from this folder on the Pi):

    sudo bash install.sh --display hdmi
    sudo reboot

What `--display hdmi` does: no DSI overlay (any DSI overlay line is commented out), `dtoverlay=vc4-kms-v3d` and
`disable_overscan=1` under `[all]`, cage + snap Chromium full screen at the monitor's native mode, mouse pointer visible,
opens `http://localhost/dashboard?kiosk=1&display=hdmi`. Screen off uses wlopm (DPMS); there is no brightness slider (no
backlight on HDMI). The on-screen keyboard only appears when a touch screen is connected. Landscape (16:9) boot/shutdown splash.

Dashboard (`/dashboard`, screens >= 1400 px wide in landscape): ADS-B map 60 %, FM radio, spectrum and aircraft list
on the right, status strip on top, tabs as a left rail. Phones get the normal layout.

Map zoom-lag fix (web/maplib/adsb-map.js, 1.0.7): aircraft/ring data are not re-sent while a zoom or pan gesture is
running (applied once at moveend), rings recompute on zoomend in one animation frame, lighter GeoJSON sources, no
resource timing / expired-tile refresh. Same layers and paint. Ready to port to handheld; not shipped there.

---

# Stillwave Trace (station package)

Trace is the Stillwave desk / station radio: a Raspberry Pi 4 with an RTL-SDR (Nooelec NESDR v5) that tunes FM to Icecast, shows a live spectrum + waterfall, runs RF detection, or shows ADS-B aircraft on an offline live map. Only one of those owns the dongle at a time (see **Dongle modes**).

> **Names.** Stillwave Trace was called Quietline Fieldnote. Only the user-facing name changed. Commands, services and files keep their `sdr-*` and `fieldnote-*` names so an installed Pi upgrades in place: `fieldnote-display-setup` (now also `trace-display-setup`), `fieldnote-kiosk.service`, the Chromium profile `~/snap/chromium/common/fieldnote-kiosk`, `fieldnote.css`, `80-fieldnote-headless.*`.

The UI is built for the **Raspberry Pi Touch Display 2, 5″** in portrait (720×1280) and also works well on a **phone browser** (~390 px). Power today is an Anker 20000 mAh bank (not PiSugar). Sweep (Stillwave Pebble) is on hold and is not part of this package.

This folder is the full deployable export. `install.sh` copies the scripts, pages, and systemd units onto the box.

## What you need

- **Computer:** Raspberry Pi 4 (4 GB is fine) running **Ubuntu 24.04** or **Raspberry Pi OS** with NetworkManager. Other Debian/Ubuntu boxes work if `apt` can install the packages below.
- **SDR:** Nooelec NESDR v5 (or any RTL2832U / R820T2 dongle) on USB.
- **Audio (optional):** a Bluetooth speaker (A2DP) for playing FM from the box itself, e.g. the Ultimate Ears WONDERBOOM 4. See **Bluetooth speaker**. Without one, listen on a phone.
- **Power:** USB-C bank (Anker 20000 mAh works). Keep the Pi and dongle powered; brown-outs drop USB.
- **Display (optional):** Raspberry Pi Touch Display 2, 5″ (DSI, 720×1280 portrait). See **Turning on the 5" display**. Any phone on the same Wi-Fi (or Trace’s hotspot) works too.
- Internet during install (`apt-get`).
- A Wi-Fi adapter that can do AP mode if you want the phone hotspot. Check with `iw list | grep -A 12 "Supported interface modes"` and look for `AP`.
- Ethernet is optional. It stays up when you switch Wi-Fi, which is useful as a back door.

## First install

From a Mac (or any computer) on the same network as the Pi:

```bash
scp sdr-station-deploy.zip neo@SDRpi.local:~
ssh neo@SDRpi.local
```

Then on the Pi:

```bash
rm -rf ~/sdr-station
unzip -o ~/sdr-station-deploy.zip -d ~     # or: python3 -m zipfile -e ~/sdr-station-deploy.zip ~
cd ~/sdr-station
sudo bash install.sh                       # add --display to also set up the 5" Touch Display kiosk
```

The installer does not switch networks: if the Pi is on Wi-Fi it stays on Wi-Fi, and it records that (`MODE=wifi`) so the next reboot does too.

The installer:

1. Installs `rtl-sdr`, `sox`, `ffmpeg`, Icecast2, Flask, `python3-numpy`, nginx, NetworkManager, `hostapd`, and `dnsmasq`. Then tries an ADS-B decoder: `readsb` (newer Ubuntu/Debian), else `dump1090-mutability` (Ubuntu 24.04 / many Pi images), both with `--no-install-recommends` so `lighttpd` never lands on port 80. If neither installs, ADS-B mode is just greyed out.
2. Blacklists the DVB kernel modules that steal the RTL dongle.
3. Installs helpers under `/usr/local/sbin` and the web app under `/usr/local/lib/sdr-station`.
4. Writes `/etc/sdr/fm.env`, `/etc/sdr/stations.conf`, `/etc/sdr/mode.env`, and `/etc/sdr/adsb.env` **only if they are not already there**. A reinstall keeps your station list, gain, Icecast source password, last dongle mode, ADS-B settings, and network mode.
5. Generates an Icecast source password and admin password on first install. The admin password is printed at the end of `install.sh`.
6. Enables `icecast2`, `sdr-web`, `sdr-net`, `sdr-mode`, and nginx. `sdr-fm` is not enabled on its own: `sdr-mode.service` starts whichever dongle mode was last used (FM on a fresh install).
7. Records the **live** network mode (on Wi-Fi → `MODE=wifi`, on the hotspot → `MODE=ap`) so a reboot comes back the same way, and installs `fieldnote-display-setup`.
8. Bluetooth speaker support: installs BlueZ, PipeWire, WirePlumber, `pipewire-pulse`, `libspa-0.2-bluetooth`, and `pulseaudio-utils`; turns on `loginctl enable-linger` for the service user so its audio session runs at boot without a login; adds that user to the `bluetooth` group; installs `sdr-bt`, the Audio page, `/etc/sdr/audio.env` (only if missing), and `sdr-bt-reconnect.service`. If these packages fail to install, the station still streams to the phone.

At the end it prints the control URL and whether each service is active. If Flask does not answer, it tails `journalctl -u sdr-web`.

## After install

Replace `HOST` with `SDRpi.local` (the Pi's hostname + `.local`), the address printed by the installer (`hostname -I`), or `10.42.0.1` when on the Trace hotspot.

| What | URL |
| --- | --- |
| Control / FM radio | `http://HOST/` |
| Spectrum + waterfall | `http://HOST/spectrum` |
| RF detect | `http://HOST/detect` |
| ADS-B aircraft | `http://HOST/adsb` |
| Tuner / find FM stations | `http://HOST/advanced` |
| Presets | `http://HOST/presets` |
| Network and services | `http://HOST/network` |
| Audio output / Bluetooth speaker | `http://HOST/audio` |
| Stream | `http://HOST:8000/live.mp3` |
| Same UI next to Icecast | `http://HOST:8000/radio.html` |
| Icecast admin | `http://HOST:8000/admin/` user `admin` |

`:8000/` by itself is Icecast’s status page, not the radio UI.

A station click restarts the dongle. Audio drops about two seconds. That is normal.

### Phone or 5″ portrait

Open any of the URLs above in the phone browser. For the Touch Display on the Pi itself see **Turning on the 5" display**; to try a page by hand:

```bash
chromium --kiosk --noerrdialogs "http://localhost/detect?auto=1&kiosk=1"
# or /spectrum?auto=1  /adsb?auto=1  /
```

`?auto=1` switches the dongle into that mode when the page loads (handy for a dedicated panel). `?kiosk=1` hides the mouse pointer inside the page (remembered by that browser; `?kiosk=0` turns it off). The arrow that cage itself draws in the middle of the Touch Display is a separate thing, see **Kiosk mouse pointer**. There is no separate portrait URL: the same pages use one responsive layout that picks up the 720×1280 portrait screen automatically, with larger tap targets and a wrapping mode bar for touch; tables scroll sideways on narrow phones.

## Power (reboot / shut down)

Every page has a **Power** button at the top right. It opens a sheet with **Reboot**, **Shut down** and a big **Cancel**. Each choice asks once more (Cancel is the first button; the confirm button only works after a short pause, so a double tap can't go through by accident).

- **Reboot:** the screen shows "Rebooting… back in about a minute" and reloads by itself when the box answers again.
- **Shut down:** phones show "Shutting down. Wait for the green light to stop blinking before unplugging." The 5″ kiosk shows a full-screen **Shutting down… Safe to unplug when this screen goes dark.**, and the very last step of the shutdown turns its backlight off (see **Kiosk screen**). On a Pi 4 the green ACT light gives a final burst of quick flashes when it is safe to remove power, then stays dark. The red PWR light stays on while the cable is plugged in.
- **Screen off** (first item in the sheet) turns the kiosk screen dark; on a phone it reads **Turn kiosk screen off / on**. See **Kiosk screen**.
- The web server answers first (HTTP 202), then the box reboots or powers off about 1 second later. The request has to be a JSON POST with `{"confirm": "reboot"}` or `{"confirm": "poweroff"}` to `/api/power/reboot` or `/api/power/poweroff`, so opening a link or a stray GET does nothing.

From SSH:

```bash
sudo sdr-power reboot       # or: sudo sdr-power poweroff
tail /var/log/sdr-power.log # who asked, when, from where
```

`/usr/local/sbin/sdr-power` accepts exactly `reboot` or `poweroff`. The web user may run only those two commands through sudo, the same way it runs `sdr-net-mode`.

## Kiosk screen (screen off, timeout, wake on touch)

The 5″ Touch Display 2 can go dark by itself or on request; the radio, map, network and speaker keep running.

- **Screen off:** the Power button at the top right, then **Screen off** (the first item), or **More → Screen off**. The screen goes dark about a second later. (The top strip has no room for one more button without cutting off the Wi-Fi name, so it stays as it was.)
- **Turn off after:** **More → Screen** offers Never, 30 s, 1 min, 2 min, **5 min** (default), 10 min, 30 min. Only touches on the 5″ screen count; using Trace from a phone doesn't keep it on. The choice is saved in `/etc/sdr/screen.env` (`SCREEN_TIMEOUT=` in seconds, 0 = never) and survives reboots and updates.
- **Wake:** touch the screen anywhere. The first touch only wakes it and never presses the button underneath: `sdr-screen` holds the touchscreen while it is dark (and until that finger lifts), and the kiosk page also lays a black catcher over everything that eats the first tap. A phone can wake it too (**Turn kiosk screen on**).
- **Brightness:** a slider on **More → Screen** when the display's backlight has levels (`SCREEN_BRIGHTNESS=` in `screen.env`; a dark minimum of 5 % is kept so the screen never looks dead while on).
- **Phones are never affected:** turning the kiosk screen off doesn't dim or cover the page on a phone.

How the screen is turned off (picked by itself, in this order; `sudo sdr-screen probe` shows which one is used and why):

1. **backlight**: the display's backlight in `/sys/class/backlight/` (on a Touch Display 2 a name like `10-0045` or `11-0045`): `bl_power` = 4 and brightness 0; on again = the saved level, then `bl_power` = 0. Real darkness, lowest power.
2. **wlopm** (DPMS through the Wayland session, if that tool exists and cage supports it; cage 0.1.5 normally does not).
3. **wlr-randr** `--output DSI-… --off`.
4. **overlay**: a black page drawn by the kiosk (backlight stays lit). Used when nothing else works. If a method fails while running, the next one takes over.

Idle = no input on the touchscreen (`/dev/input/event*` with direct-touch properties, read by `sdr-screen` itself). If no touchscreen is found, the timeout waits and it looks again every 10 s.

```bash
sudo sdr-screen probe           # backlight / touch devices / method in use; add --test to turn the screen off for 3 s
sdr-screen status               # state, timeout, method (no sudo needed)
sudo sdr-screen off             # or: on | toggle
sudo sdr-screen timeout 10m     # never | 30s | 1m | 2m | 5m | 10m | 30m
sudo sdr-screen brightness 60%  # or a raw level
journalctl -u sdr-screen -b     # what it did
```

To force a method, set `SCREEN_METHOD=backlight|wlopm|wlr-randr|overlay` (and `SCREEN_BACKLIGHT=` / `SCREEN_TOUCH=` to pick devices) in `/etc/sdr/screen.env`, then `sudo systemctl restart sdr-screen`.

**Shutdown screen:** when the box shuts down (Power menu or `sudo systemctl poweroff`), the kiosk wakes the screen and shows **Shutting down… Safe to unplug when this screen goes dark.** for about 4 s (`sdr-screen notice`, run as `sdr-screen.service` stops). Late in the shutdown, `sdr-screen-final.service` turns the backlight off as its last act. On a **reboot** it leaves the backlight on (and `sdr-screen` restores the saved brightness at every boot), so a reboot never leaves a dark screen. Only the backlight method can truly go dark at the end; with the overlay method the message simply stays until the display loses power.

## Boot and shutdown screen (1.0.5)

On a display station Trace shows its own screen while the Pi starts and stops: the radar sweep with STILLWAVE above a glowing TRACE, "// STARTING UP" (or "// SHUTTING DOWN"), on the Touch Display, with no boot text, raspberry logos or rainbow square. The last frame stays up until the kiosk draws, so there is no console flash. When you pick Shut down or Restart in the kiosk, the page switches to the same picture with "// SHUTTING DOWN…" and the safe-to-unplug lines; the backlight still goes dark at the end, as before.

It is a Plymouth theme (`stillwave-trace`, files in `/usr/share/plymouth/themes/stillwave-trace`). `install.sh` turns it on (also on over-the-air updates) with `sdr-splash auto`, which changes, all reversibly:
- `cmdline.txt`: adds `quiet splash loglevel=3 vt.global_cursor_default=0 logo.nologo plymouth.ignore-serial-consoles` (only the missing ones; the first-ever copy is kept as `cmdline.txt.stillwave-orig`)
- `config.txt`: `disable_splash=1` in a marked `[all]` block at the end (first-ever copy: `config.txt.stillwave-orig`)
- the default Plymouth theme, plus `/etc/initramfs-tools/hooks/stillwave-splash` (display drivers in the initramfs so the splash shows early) and `update-initramfs -u`
- a `plymouth-quit.service` drop-in (`plymouth quit --retain-splash`)

It skips itself when plymouth or the initramfs boot is missing, and every failure undoes its own changes, so the worst case is the normal text boot. After an update the health check also checks the boot files and the initramfs; if anything is off it turns the splash off and the update rolls back.

```
sudo sdr-boot-setup --splash off      # back to the normal text boot (stays off through updates)
sudo sdr-boot-setup --splash on       # on again
sdr-boot-setup --splash status
```

Without SSH (SD card in a Mac): open the `system-boot` volume, edit `cmdline.txt` (one line) and delete ` quiet splash loglevel=3 vt.global_cursor_default=0 logo.nologo plymouth.ignore-serial-consoles` from its end, or copy `cmdline.txt.stillwave-orig` over `cmdline.txt`. Without `splash` the Pi boots in text mode even though the theme is still installed; run `sudo sdr-boot-setup --splash off` afterwards to clean up the rest.

## Bootloader settings (Pi 4 EEPROM)

The installer sets the bootloader options **POWER_OFF_ON_HALT=1** and **WAKE_ON_GPIO=0**, so after a shutdown the Pi 4 powers fully down (its power chip switches off). To start the box again, unplug the power and plug it back in. Only these two keys change; every other line of the bootloader config stays as it is, and no new bootloader is installed (it applies after one reboot).

Per the Raspberry Pi bootloader documentation, POWER_OFF_ON_HALT only powers the board fully off when WAKE_ON_GPIO=0, which is why both are set. With WAKE_ON_GPIO=0 a button on GPIO3 can no longer wake the Pi; if a power button is added later, set WAKE_ON_GPIO back to 1. The 5 V header pins (display and fan power) stay live while the cable is plugged in. `sudo sdr-power eeprom-status` prints what the Pi does after a shutdown (`after a shutdown: …`).

- It uses `rpi-eeprom-config` (`sudo apt install rpi-eeprom` if it is missing; without it the step is skipped with a message and nothing else fails).
- It never installs a newer bootloader: the change is applied with the image of the bootloader that is already running (matched by its build time, `vcgencmd bootloader_version`). If that image isn't on disk, nothing is changed.
- It takes effect **after the next reboot** (the Pi writes the EEPROM during that boot). If a change is already waiting for a reboot, it doesn't stage another one.
- Pi 4 / CM4 only; skipped elsewhere. Log: `/var/log/sdr-power.log`.

```bash
sudo sdr-power eeprom-status    # bootloader version, POWER_OFF_ON_HALT / WAKE_ON_GPIO, what happens after a shutdown, pending change
sudo sdr-power eeprom-setup     # (re)apply
```

## Dongle modes

There is one RTL-SDR, so exactly one of these owns it:

| Mode | Service | Page |
| --- | --- | --- |
| `fm` (default) | `sdr-fm` → Icecast `live.mp3` | `/` |
| `spectrum` | `sdr-spectrum` (rtl_sdr + numpy FFT) | `/spectrum` |
| `detect` | `sdr-detect` (rtl_power wide passes, or rtl_sdr FFT for ranges ≤ 2 MHz) | `/detect` |
| `adsb` | `sdr-adsb` (readsb / dump1090-mutability) | `/adsb` |

Switch from any page with the **Mode** buttons at the top, or on the box:

```bash
sudo sdr-mode set spectrum     # fm | spectrum | detect | adsb
sudo sdr-mode status           # JSON: active mode, saved mode, ADS-B decoder
cat /etc/sdr/mode.env          # MODE=... restored at boot
```

- Switching stops the current owner first, then starts the new one (about 1–3 seconds).
- The units also have `Conflicts=` on each other, so anything that starts FM (a station button, Listen, Save preset, **Restart radio stream**) automatically takes the dongle back to FM.
- The last mode is saved in `/etc/sdr/mode.env` and `sdr-mode.service` restores it at boot. A fresh install is `MODE=fm`.
- **Find stations 88–108 MHz** on the Tuner page borrows the dongle and puts the previous mode back afterwards.
- **Restart all** on the Network page restarts whatever mode is active instead of forcing FM.
- The spectrum/detect pages do not grab the dongle just by opening them; they show a **Start** button unless you use `?auto=1`.

### Spectrum + waterfall (`/spectrum`)

Up to 2.4 MHz around a center frequency, about 8 rows a second. Controls: center (◀ ▶ step half a span), span (0.25–2.4 MHz), gain, FFT size, rows/s, auto or manual color levels, peak hold. Tap the trace to drop a marker; **Center here** retunes on it, **Listen on FM radio** switches back to FM at that frequency (wideband FM only). Settings persist in `/var/lib/sdr-station/scope.json`.

When no browser is watching, the service keeps the dongle but skips the FFT work, so an idle spectrum mode costs almost no CPU.

### RF detect (`/detect`)

- Default range is 24–1700 MHz. Band buttons: FM broadcast, airband, 2 m, marine/NOAA, 315 MHz keyfobs/TPMS, 70 cm, 433 ISM, FRS/GMRS, cell 700/850, 915 ISM, ADS-B 1090, AWS uplink.
- Each pass builds a local noise floor (25th percentile in blocks, smoothed over passes). Anything more than **Threshold dB** above it is listed with frequency, power, dB above floor, and width. **Relearn floor** starts over (use it after moving or changing gain).
- **Recent hits** keeps intermittent signals (keyfobs, push-to-talk) for **Keep hits** seconds, with hit counts.
- The big meter shows the strongest signal, or the locked frequency (**Track** / **Lock meter**). **Zoom** narrows to ±0.5 MHz around a signal. At ≤ 2 MHz the page switches to the fast IQ path (about 5 updates a second), which is what you want for walking toward a transmitter. **Beep** plays clicks that get faster and higher as the signal gets stronger.
- A full 24–1700 MHz pass is slow (tens of seconds on a Pi). Use a band button or a narrow range for anything live.
- dB values are relative, not calibrated dBm. Very strong nearby transmitters can also show up as images at other frequencies; turn the gain down if the list fills with junk.

### ADS-B (`/adsb`)

A live **Map** (see **Map (ADS-B)** below) and a **List** of aircraft (flight, hex, altitude, speed, track, distance, squawk, RSSI) from `/run/sdr-adsb/aircraft.json`, updated every second. A 1090 MHz antenna (a 6.9 cm whip) works far better than the FM antenna. Settings live in `/etc/sdr/adsb.env`:

```bash
ADSB_GAIN=auto        # or e.g. 40.2 / 49.6
ADSB_PPM=0
ADSB_LAT=             # receiver position; empty = LAX (set it from the page: List > Receiver position)
ADSB_LON=
```

Then switch to another mode and back to ADS-B (or `sudo systemctl restart sdr-adsb`). The packaged `readsb.service` / `dump1090-mutability` boot services are disabled by the installer so they never steal the dongle; `sdr-adsb` runs the binary only in ADS-B mode.

## Map (ADS-B)

The ADS-B page opens on a live map centered on LAX. It works on the `Trace` hotspot with **no internet**: the map library, fonts, icons and the map itself are all on the Pi.

Plane colors show altitude in 8 steps, from a greyed-out green on the ground to white at cruise: GND `#5f7a68`, under 1,000 ft `#1c6b3c`, 1–3k `#26904f`, 3–6k `#33b866`, 6–10k `#4ade80`, 10–20k `#97f0b8`, 20–30k `#c8f8d9`, 30k+ `#f4fff7`. Unknown altitude is grey `#6b6f6d` at 60 %. The bar under the map is the legend, and every label also shows the altitude as text. Range rings rescale with the zoom (0.5, 1, 2.5, 5, 10, 25, 50 or 100 nm apart) and are labeled in nm. The **RINGS** button opens a small panel: RINGS off / 2 / 3 / 4 / 6 (default 3) and SPACING auto (the rings fill the view; 5 nm apart at the default LAX zoom) or 1 / 2.5 / 5 / 10 nm at the default zoom, still rescaling as you zoom. The choice is saved on the box in `/etc/sdr/adsb.env` (`ADSB_RINGS`, `ADSB_RING_SPACING`; CLI: `sudo sdr-maps rings 3 auto`), so the 5″ screen and every phone share it. Upgrades keep it.

**Radio page (1.0.4):** preset buttons show the call sign and frequency on one line (e.g. KKGO 105.1); the full name is in Now playing and above the tuned station on the FM dial, which otherwise shows only frequency numbers and small preset ticks. Presets outside 88–108 MHz (e.g. NOAA weather) are left off the dial. The More page row titles use the same mono capitals as the buttons.

**Look (1.0.3):** the UI follows the Stillwave brand: Night `#0B0F0C` background, Panel `#111C15` cards, Paper `#E6EFE8` text, Static `#A3B5A9` labels, Signal `#4ADE80` for live, selected and data (with a static glow), and a faint Signal grid. Orange and red are only used for warnings, errors and Shut down. Headlines use Anton, labels, buttons, tabs and the status strip use JetBrains Mono in capitals, and body text uses the system Helvetica/Arial (Liberation Sans on the Pi). Both fonts are bundled in `web/fonts/` with their SIL OFL 1.1 license texts, so nothing loads from the internet.

- **Planes:** icons point along their track and are colored by altitude (legend under the map). Labels show callsign (or hex), altitude in ft and speed in kt. A line shows the last ~2 minutes of each track. A plane whose position is older than 15 s fades, and it is dropped after 60 s.
- **Tap a plane** for its card: hex, callsign, altitude, speed, track, vertical rate, squawk, how long ago it was seen, and distance from the receiver. **Follow** keeps it centered; dragging the map stops following.
- **Buttons:** Center on LAX, Center on me (the receiver position), RINGS (opens the range-ring panel; shows the ring count), Labels. Drag to pan, pinch or double-tap to zoom. The top line counts all aircraft and how many have a position on the map.
- **List** shows the table (no change from before) plus **Receiver position**. Until you save one, the receiver is LAX. The position is stored in `/etc/sdr/adsb.env` (`ADSB_LAT` / `ADSB_LON`) and handed to the decoder too. From SSH: `sudo sdr-maps receiver 34.05 -118.25`, or `sudo sdr-maps receiver --clear` to go back to LAX.
- The page asks `/api/adsb` once a second, only while ADS-B mode is on and the page is visible.

**Map data.** `maps/la.pmtiles` in this package is a Protomaps basemap extract (vector tiles, build 20261006, 57,188,216 bytes / about 55 MB). It covers Southern California (about 33.25–34.80 N, 119.45–117.30 W) at zoom 0–11, and the LA basin (33.55–34.30 N, 118.75–117.90 W) down to street level at zoom 12–14. Outside the basin the map still shows the zoom-11 detail when you zoom in. The data is © OpenStreetMap contributors under the Open Database License (ODbL), via the Protomaps basemap (OpenStreetMap + Natural Earth). The map shows that attribution in its corner; keep it visible. The tiles were cut from the public Protomaps daily build with the `pmtiles` CLI, not downloaded from tile.openstreetmap.org.

`install.sh` copies the tiles to `/var/lib/sdr/maps/la.pmtiles` (plus `la.json` with the checksum and source). It skips the copy if the same file is already there, and never replaces a newer map from `sdr-maps fetch`. nginx serves the file at `/maps/la.pmtiles` with HTTP Range requests, and the browser reads only the tiles it needs. The map code lives in `/usr/local/lib/sdr-station/web/maplib/` (served at `/maplib/`): MapLibre GL JS 6.13.0, PMTiles 4.5.0, the Protomaps basemap style 5.7.2 (recolored to the Trace palette), Noto Sans glyphs and the Protomaps dark sprite. Their licenses are in `maplib/licenses/` (BSD-3-Clause, SIL OFL 1.1, MIT). No CDN is used.

```bash
sudo sdr-maps status            # JSON: installed, size, build, manifest
sudo sdr-maps verify            # sha256 of la.pmtiles against la.json
sudo sdr-maps fetch             # optional refresh: needs internet ONCE (home Wi-Fi), ~300 MB free, a few minutes
sudo sdr-maps fetch --force     # re-cut even if the installed file matches
```

`fetch` downloads a pinned, checksum-checked `pmtiles` CLI (v1.31.2) into `/var/lib/sdr/maps/bin/`. It reads the newest build from `build-metadata.protomaps.dev`, cuts the same two areas with Range requests (it does not download the whole planet), merges and verifies them, then swaps the file in. Afterwards the Pi works offline again.

**If the map looks wrong:**
- *“Basic map only …” note:* `la.pmtiles` is missing, so the page draws a small built-in outline (coast, freeways, LAX runways). Re-run `install.sh` from the package, or `sudo sdr-maps fetch` once with internet.
- *“cannot draw the map (no WebGL)”:* the browser has no WebGL, and the page switches to List. On the 5″ display, look in `~/.cache/fieldnote-kiosk/chromium.log` for GPU errors.
- *Map is blank but planes move:* check `curl -sI -r 0-99 http://127.0.0.1/maps/la.pmtiles` (expect `206`) and `curl -sI http://127.0.0.1/maplib/maplibre-gl.mjs` (expect `200`, `application/javascript`).

## Switching networks

Trace is either on your **home Wi-Fi** (open `http://SDRpi.local/`) or runs its own **hotspot** `Trace` (join it, open `http://10.42.0.1/`). `Trace` is the hotspot name on a **new** install; a Pi that already has a hotspot keeps its name and password through upgrades (for example the `Hotspot` profile with SSID `NeoSDR`). The hotspot is 2.4 GHz so every phone sees it; home networks on 5 GHz are fine.

Every switch runs in the background (a `sdr-netswitch-…` systemd unit), so it finishes even though your SSH session or the web page drops when the radio changes. A Wi-Fi join counts as done only when `wlan0` gets a real (non-10.42) address within about 45 seconds. If not, the box **brings the hotspot back by itself**, so you are never locked out. Each switch ends with a `RESULT` line in `/var/log/sdr-net.log`.

### From the web (Network page)

1. Pick a network under **Saved networks** or **Nearby** (tap **Scan for networks**), or type its name. Enter the password for a new network; leave it empty for a saved one.
2. Tap **Join Wi‑Fi** (or **Switch to hotspot**), read the message, tap **Switch now**.
3. Your phone disconnects. Rejoin your home Wi-Fi and open `http://SDRpi.local` (or the Trace hotspot at `10.42.0.1` if it fell back). The last result is shown at the top of the page.

The hotspot password is hidden until you tap **Show hotspot password**. Status JSON (`/api/net`) never contains passwords. While the hotspot is on, the radio may not see other networks; saved networks and typing the name still work.

### From SSH

```bash
sudo sdr-net-mode wifi                              # saved home network (HOME_CON, else HOME_SSID, else best saved profile)
sudo sdr-net-mode wifi MyHomeWifi           # a saved network by SSID
sudo sdr-net-mode wifi "My Network" 'password'      # new network, or update a saved password
sudo sdr-net-mode ap                                # Trace hotspot
sudo sdr-net-mode last                              # how did the last switch go?
tail -f /var/log/sdr-net.log                        # every step
```

- Run it in the **foreground** (no `&`). It returns in a second and keeps working on its own; your SSH session then drops when the radio changes. Reconnect with `ssh neo@SDRpi.local` (home Wi-Fi) or join `Trace` and `ssh neo@10.42.0.1`.
- Leave out the password and it asks for it (only for a network with no saved profile). `--foreground` runs the switch inline for debugging (it survives the SSH hang-up, but you will not see the end).
- Joining reuses an existing NetworkManager profile for that SSID (updating the password if you give one, autoconnect on, priority 200), or creates one. A wrong password is not saved: the old one is put back.
- Hotspot mode keeps your home profile and its password; it only turns that profile's autoconnect off so NetworkManager does not grab the radio at boot.
- Ethernet, if plugged in, stays up through all of this and is the easiest back door.

## Reboot behavior

The last successful choice is stored in `/etc/sdr/net.env` (root-only; it also holds the hotspot password `AP_PASS`):

- `MODE=ap` — boot starts the hotspot again.
- `MODE=wifi` — boot waits for NetworkManager to join `HOME_CON` / `HOME_SSID` (and joins it explicitly if needed). If the home network is not reachable within about a minute, the hotspot comes up **for that boot only**; the next reboot tries Wi-Fi again.

`sdr-net.service` runs `sdr-net-mode boot` after NetworkManager.

Check:

```bash
sudo sdr-net-mode status
sudo sdr-net-mode last
systemctl status sdr-net
```

## Bluetooth speaker

Trace can play FM radio **from the box itself** on a Bluetooth speaker, so you do not need the phone stream. On the **Audio** page (or with `sudo sdr-bt output ...`), choose where FM plays:

- **Phone stream:** Icecast only. This is the original behavior and the default.
- **Pi speaker:** the box's default audio output. That is the Bluetooth speaker while it is connected, and the onboard jack or HDMI otherwise.
- **Both:** both at once.

The choice is saved in `/etc/sdr/audio.env` (`AUDIO_OUT=`) and comes back after a reboot. Changing it restarts the FM stream, which drops audio for about a second. If the Pi audio service is not reachable, FM falls back to the phone stream on its own, so the phone always works. `journalctl -u sdr-fm` then says why.

### Pairing an Ultimate Ears WONDERBOOM 4

From Logitech/UE's WONDERBOOM 4 *Getting Started* guide:

1. Turn the speaker on with the power button on top.
2. **Press and hold the Bluetooth button until you hear a tone.** The Bluetooth button blinks fast while the speaker is in pairing mode.
3. On the **Audio** page tap **Search for speakers** (about 12 seconds), then tap **WONDERBOOM 4** in the list. Trace pairs, trusts, and connects it, makes it the default output, and remembers it. The speaker plays its confirmation sound when it connects.
4. Set **Where FM plays** to **Pi speaker** or **Both**.

Good to know about this speaker (same guide, and Logitech's spec sheet):

- When switched on, it **reconnects to the last device it was connected to**. If that was your phone, either turn Bluetooth off on the phone or tap **Connect** on the Audio page. Once the Pi was the last device, the speaker should reconnect to the Pi by itself when you switch it on (the Pi trusts it).
- It remembers up to 8 devices and can be connected to 2 at the same time (the Pi and a phone can take turns).
- Bluetooth 5.2, rated range 40 m. Reviews report SBC as the only codec, which is the codec BlueZ/PipeWire always supports.

Other speakers work the same way. Put them in pairing mode as their manual describes, then search.

### What happens at boot

`sdr-bt-reconnect.service` runs `sdr-bt autoconnect`. It tries the saved speaker for about a minute and makes it the default output. If the speaker is off, Pi audio stays on the onboard output. WirePlumber remembers the chosen output, so a speaker that connects later (for example when you switch it on) becomes the output again. When it disconnects, audio moves back to the onboard output.

### From SSH (or when the web page misbehaves)

```bash
sudo sdr-bt status                     # JSON: adapter, saved speaker, connected?, default output, FM output mode
sudo sdr-bt scan                       # search ~12 s (speaker in pairing mode), lists audio devices first
sudo sdr-bt pair AA:BB:CC:DD:EE:FF     # pair + trust + connect + make default + remember
sudo sdr-bt connect                    # reconnect the saved speaker
sudo sdr-bt disconnect
sudo sdr-bt forget AA:BB:CC:DD:EE:FF   # unpair
sudo sdr-bt output speaker             # phone | speaker | both
tail -50 /var/log/sdr-bt.log
```

If `sdr-bt` cannot pair, do it by hand in `bluetoothctl` (speaker in pairing mode), then let `sdr-bt` take over:

```bash
bluetoothctl
  power on
  agent NoInputNoOutput
  default-agent
  scan on            # wait for "WONDERBOOM 4" and note its address
  scan off
  pair AA:BB:CC:DD:EE:FF
  trust AA:BB:CC:DD:EE:FF
  connect AA:BB:CC:DD:EE:FF
  quit
sudo sdr-bt connect AA:BB:CC:DD:EE:FF  # remembers it and makes it the default output
```

### If there is no sound on the speaker

- `sudo sdr-bt status`: check `"pulse": true` (PipeWire is running for the service user) and `"speaker_default": true`.
- Check the audio session: `systemctl --user status pipewire pipewire-pulse wireplumber` (as `neo`), `loginctl show-user neo -p Linger` should print `Linger=yes`, and `wpctl status` lists the speaker under Sinks.
- If the speaker connects but no `bluez_output…` sink appears, WirePlumber is refusing Bluetooth for a user without an active login seat. The installer ships the fix for both WirePlumber generations: `/etc/wireplumber/bluetooth.lua.d/80-fieldnote-headless.lua` (0.4, Ubuntu 24.04) and `/etc/wireplumber/wireplumber.conf.d/80-fieldnote-headless.conf` (0.5+). Apply it with `systemctl --user restart wireplumber` as `neo`.
- Choppy audio: the Pi 4's Wi-Fi and Bluetooth share one 2.4 GHz radio. On a 5 GHz home network that is fine. In **hotspot mode** (2.4 GHz) or on a busy 2.4 GHz network the speaker can stutter, so keep it close to the Pi.
- `systemctl status bluetooth` and `rfkill list` (Bluetooth must not be blocked).

## Turning on the 5" display

Raspberry Pi Touch Display 2, 5-inch, on a Pi 4 ([official guide](https://www.raspberrypi.com/documentation/accessories/touch-display-2.html)):

1. Power off. Ribbon: use the supplied **15-way to 15-way** cable into the Pi 4 connector labelled **DISPLAY** (contacts toward the USB/Ethernet ports; on the display, contacts face away from the panel). Power: the supplied GPIO cable, red to **pin 2 (5 V)**, black to **pin 6 (GND)**.
2. Power on. Native mode is 720×1280 portrait, which is what Trace wants, so no rotation is needed. Raspberry Pi OS finds the panel by itself (`display_auto_detect=1`). Ubuntu 24.04 does not, so the setup script writes the overlay explicitly (see **Ubuntu 24.04 notes**).
3. Set up the kiosk:

```bash
sudo trace-display-setup          # same script as fieldnote-display-setup; or: sudo bash install.sh --display
sudo reboot                       # only if it says config.txt changed
```

`fieldnote-display-setup`:

- Edits `/boot/firmware/config.txt` (or `/boot/config.txt`) **section-aware**. Exactly one `dtoverlay=vc4-kms-v3d` line (existing options such as `,cma-128` are kept) and, where needed, `dtoverlay=vc4-kms-dsi-ili9881-5inch` end up where a Pi 4 reads them: in one marked block under the final `[all]`. Duplicates and copies under `[all]`/`[pi4]` are commented out with a `#fieldnote# ` prefix. Lines under other boards' sections (`[pi3+]`, `[cm4]`, …) are left alone. `display_auto_detect=1` is commented out whenever the overlay is written explicitly, as Raspberry Pi recommends. It always does that on Ubuntu and with `--force-overlay`. `--rotate 180` is there for an upside-down mount (untested). A backup is kept next to the file, and if nothing needs changing the file is not touched.
- **Desktop** image (Raspberry Pi OS): autologin to the desktop as the user who ran sudo (e.g. `neo`), Chromium in kiosk mode from the desktop autostart, screen blanking off. The on-screen keyboard appears for text fields.
- **Lite / Ubuntu Server:** installs `cage` (a minimal Wayland kiosk) and Chromium (apt on Raspberry Pi OS, **snap** on Ubuntu) and runs them as `fieldnote-kiosk.service` on tty1 as that user (a real logind session via PAM, user in `video`, `render`, `input`). There is no desktop, so use a phone or a USB keyboard to type Wi-Fi passwords. Ubuntu Desktop (GDM) is not set up automatically.
- The launcher `/usr/local/bin/fieldnote-kiosk` waits for the web UI, opens `http://localhost/?kiosk=1` (pointer hidden, 125% touch buttons, touch works), and restarts the browser with a back-off if it crashes. Snap Chromium keeps its profile in `~/snap/chromium/common/fieldnote-kiosk`, because snap confinement blocks `~/.config`.
- Logs: launcher messages go to `journalctl -t fieldnote-kiosk` (plus `journalctl -u fieldnote-kiosk -b` with cage). Browser output goes to `~/.cache/fieldnote-kiosk/chromium.log`, rotated at 1 MB.
- Re-running it, or re-running `install.sh --display`, on a working setup changes nothing. `sudo fieldnote-display-setup --undo` removes all of it and restores `config.txt` byte for byte. Packages stay installed.

If the screen stays dark: check both cable ends and the GPIO pins, then `sudo apt update && sudo apt full-upgrade` (older kernels lack the Touch Display 2 driver) and reboot. `grep -n 'vc4\|ili9881\|display_auto' /boot/firmware/config.txt` should show one active `dtoverlay=vc4-kms-v3d…` and one `dtoverlay=vc4-kms-dsi-ili9881-5inch` line under the last `[all]` (in the `fieldnote-display` block, or where you put them by hand).

If the kiosk does not start (cage):

- `journalctl -u fieldnote-kiosk -b` with `libseat`, `Could not take control of session`, `Permission denied` on `/dev/dri/card*` or input devices: the session did not become a proper seat session. Check `id neo` lists `video render input` (log out/reboot after a group change), `/etc/pam.d/fieldnote-kiosk` exists, `getty@tty1` is not running (`systemctl status getty@tty1`), and `loginctl` shows a `seat0` session on `tty1` for `neo`.
- Chromium lines about Bluetooth/BlueZ D-Bus access in `chromium.log` do not affect the page; speaker audio is played by PipeWire, not the browser.
- `snap run chromium` errors about `SingletonLock` or the profile mean an old launcher with a `~/.config` profile. Re-run `sudo fieldnote-display-setup`.

### Kiosk mouse pointer

cage (0.1.5 on Ubuntu 24.04) has no option to hide its pointer. When it thinks a pointer device exists (the Touch Display 2 and some USB/Bluetooth devices announce one), it draws the default arrow in the middle of the screen, outside Chromium, so the page's CSS can't hide it. Trace fixes this with a fully transparent cursor theme:

- `/usr/share/icons/fieldnote-blank/` holds a transparent cursor (all common cursor names).
- `/usr/local/share/fieldnote-cursor/` holds links named `default` and `fieldnote-blank` that point to that theme.
- A systemd drop-in, `/etc/systemd/system/fieldnote-kiosk.service.d/fieldnote-cursor.conf`, sets `XCURSOR_PATH=/usr/local/share/fieldnote-cursor`, `XCURSOR_THEME=fieldnote-blank` and `XCURSOR_SIZE=24` for the kiosk only. cage loads the theme called `default` from that path, which is now invisible. The kiosk unit itself (including any hand edits) is not changed.

```bash
sudo fieldnote-display-setup --hide-cursor   # apply / re-apply (restarts the kiosk only if it is running)
sudo fieldnote-display-setup --show-cursor   # bring the arrow back (e.g. for a real mouse)
```

Both touch only the cursor files, the drop-in and `CURSOR=` in `/etc/sdr/display.env`. Add `--no-restart` to apply it at the next kiosk start instead. `install.sh` re-applies the hidden pointer whenever the kiosk service exists, unless you chose `--show-cursor`. To see which device cage treats as a pointer: `sudo apt install libinput-tools && sudo libinput list-devices`.


**1.0.6:** the pointer could still sit in the middle of the screen: cage's own pointer was blank, but once snap Chromium had pointer focus it drew its built-in arrow (the snap cannot read the blank theme under /usr/local), and over-the-air updates never added the hidden-pointer drop-in at all. Now the drop-in also runs `/usr/local/bin/fieldnote-kiosk-cursor` before the kiosk starts, which copies the blank theme into `/var/snap/chromium/common/fieldnote-cursor` (readable by the snap, same path inside and outside it; the helper also adds it to the snap's own `~/.icons`) under the theme names Chromium may ask for, and `XCURSOR_PATH` lists that folder first. The 1.0.6 update applies it once (even if the pointer had been set to shown); it takes effect at the next reboot (or `sudo systemctl restart fieldnote-kiosk`). Pages also use `cursor: none` in kiosk mode. Phones are not affected.

### On-screen keyboard (1.0.6)

On the kiosk, tapping any text, password or number field slides up a keyboard (letters with Shift, numbers, symbols, Backspace, Space, Done). Number fields (frequency, receiver position, gain …) open a number pad. The page scrolls so the field stays above the keyboard; Done or a tap outside closes it. Chromium's own keyboard is held off. Phones use their own keyboard as before. File: `web/kbd.js`, loaded on every page.

## Ubuntu 24.04 notes

The real Trace box runs **Ubuntu 24.04 LTS (arm64, `linux-raspi`)**. What differs from Raspberry Pi OS:

- **Display:** `display_auto_detect=1` alone did not bring up the Touch Display 2. The setup always writes `dtoverlay=vc4-kms-dsi-ili9881-5inch` and comments out `display_auto_detect=1`. Ubuntu's stock `config.txt` has `dtoverlay=vc4-kms-v3d` only under `[pi3+]`/`[pi02]`, so the script adds the Pi 4 copy under the last `[all]`. If you already fixed `config.txt` by hand, the script recognizes the existing lines and leaves them alone (no duplicates).
- **Chromium is a snap** (`snap install chromium`). Its profile must live under `~/snap/chromium/common/`.
- **No `raspi-config`:** all calls to it are guarded. The kiosk is the cage service on tty1, and the boot target becomes `graphical.target`.
- **Netplan:** NetworkManager on Ubuntu stores Wi-Fi profiles it creates or edits as `/etc/netplan/90-NM-*.yaml`. That is expected. Do not also define `wlan0` in `50-cloud-init.yaml`, or netplan and `sdr-net-mode` will fight over the radio. `systemd-networkd` may keep `eth0`, which the installer leaves alone.
- **Audio:** PipeWire runs as a user service of `neo` (lingering), not system-wide. `sdr-fm` starts after `user@<uid>.service` so FM can reach it at boot.
- **Packages:** `universe` is enabled by the installer. `dump1090-mutability` is the ADS-B decoder on 24.04.

## Redeploy

Keeps the offline map in `/var/lib/sdr/maps/` (not copied again when unchanged), `/etc/sdr/fm.env`, `/etc/sdr/stations.conf`, `/etc/sdr/net.env`, `/etc/sdr/mode.env`, `/etc/sdr/adsb.env`, `/etc/sdr/audio.env` (output choice + saved speaker), and the display/kiosk setup. The Bluetooth pairing itself lives in BlueZ and survives too.

```bash
# on the Mac
scp sdr-station-deploy.zip neo@SDRpi.local:~
ssh neo@SDRpi.local
# on the Pi
sudo systemctl stop sdr-fm sdr-spectrum sdr-detect sdr-adsb sdr-web || true
rm -rf ~/sdr-station
unzip -o ~/sdr-station-deploy.zip -d ~
cd ~/sdr-station
sudo bash install.sh
```

The full zip is about 55 MB larger because it carries the offline map. For updates when the Pi already has the map, use the small **`sdr-station-app.zip`** instead. It is the same package without `maps/la.pmtiles`. `install.sh` then prints "keeping the installed /var/lib/sdr/maps/la.pmtiles" and leaves the map alone:

```bash
# on the Mac
scp sdr-station-app.zip neo@SDRpi.local:~
ssh neo@SDRpi.local
# on the Pi
sudo systemctl stop sdr-fm sdr-spectrum sdr-detect sdr-adsb sdr-web || true
rm -rf ~/sdr-station
unzip -o ~/sdr-station-app.zip -d ~
cd ~/sdr-station
sudo bash install.sh
bash verify.sh
```

## Updates (over the air)

Every station function works offline. **Updates are the only part of Trace that ever uses the internet, and only when you tap Check or Install.** Trace never checks by itself and makes no background network calls.

The installed version is in `/usr/local/lib/sdr-station/VERSION`. You can see it on **More → Updates**, in `bash verify.sh`, and with `sdr-update version`.

**From the screen or phone:** go to More → Updates → **Check for update**. If a newer version is offered, read the notes and tap **Install**, then confirm. The page shows Download → Check signature → Install → Check it works. The web app restarts during the install. The page keeps waiting and then shows the result. In hotspot mode, or with no internet, Check says "Needs internet: connect to home Wi‑Fi". Switch to home Wi‑Fi on the Network page first.

**Where updates come from:** `UPDATE_URL` in `/etc/sdr/update.env`. Set it under More → Updates → *Update source*, or from SSH:

```bash
sudo sdr-update set-url http://192.168.1.50:8000/     # a folder that contains latest.json
sudo sdr-update check
sudo sdr-update apply            # runs in the background (systemd-run); follow with: sudo sdr-update status
```

The URL can be any plain folder that holds `latest.json` and the files it names: a laptop running `python3 -m http.server 8000`, a static web host, or GitHub Releases (`https://github.com/OWNER/REPO/releases/latest/download/`). Bundle links inside `latest.json` may be relative (the default) or absolute.

**Without network (USB stick or phone):** under More → Updates → *Install from file*, pick the `trace-update-X.Y.Z.ota` file (or the `.tar.gz` and its `.sig` together). From SSH:

```bash
sudo sdr-update apply-file /media/neo/USB/trace-update-1.0.1.ota
```

**What is checked:**
- Every update is signed with the Stillwave key (Ed25519). The Pi has only the public key, in `/usr/local/lib/sdr-station/keys/stillwave-update.pub`.
- Trace checks the signature, the sha256 of the bundle, and every file inside it before anything is installed.
- Older versions are refused. A bundle can also require a minimum installed version.

**What is kept:**
- The installer runs in upgrade mode (`install.sh --upgrade`).
- It keeps the offline map, `/etc/sdr/*.env` (including `net.env` and `update.env`), the hotspot and home Wi‑Fi profiles, Icecast settings, Bluetooth pairing, and the display/kiosk setup.
- Display setup is not run, apt is not run, and the network is not reconfigured.

**Rollback:**
- Trace keeps the previous version in `/var/lib/sdr-update/releases/` (with the links `current` and `previous`).
- After installing, it runs `sdr-verify --health`. If that fails (or the install fails), it reinstalls the previous version by itself and reports "Went back to X.Y.Z".

**Logs:**
- `/var/log/sdr-update.log`
- `sudo sdr-update status` and `sudo sdr-update last`
- `sudo sdr-verify` (same as `bash verify.sh`), which includes an updates section

**Making a release (on the build box):**
- Run `/workspace/sdr/tools/make-release.sh --notes "…"` after bumping `VERSION`.
- It writes `trace-update-<ver>.tar.gz`, `.tar.gz.sig`, `.ota` and `latest.json` into `/workspace/sdr/out/updates/<ver>/`.
- The private key stays in `/workspace/sdr/keys/` and is never packaged.

## Verify

```bash
bash verify.sh
```

Or by hand:

```bash
systemctl is-active icecast2 sdr-web sdr-net sdr-mode nginx
sudo sdr-mode status
curl -sS http://127.0.0.1/health
curl -sS http://127.0.0.1/api/status
curl -sS http://127.0.0.1/api/mode
sudo sdr-bt status
sudo sdr-maps status
curl -sS -o /dev/null -r 0-126 -w '%{http_code}\n' http://127.0.0.1/maps/la.pmtiles   # 206
# in spectrum or detect mode, a few seconds of live frames:
curl -sN --max-time 4 http://127.0.0.1/api/scope/stream | cut -c1-120
```

## Layout on the box

- `/usr/local/lib/sdr-station/web/` — Flask app, HTML, `fieldnote.css`, `nav.js` (status strip at the top + tab bar at the bottom of every page), `more.html` (More: Tuner, Presets, Network, Audio, Screen, Updates, Power), `mode.js` (SDR mode row), `power.js` (Power menu), and `sdr_scope.py` (spectrum/detect service on 127.0.0.1:8081)
- `/usr/local/lib/sdr-station/bin/fm_stream.sh` — RTL-SDR to Icecast
- `/usr/local/lib/sdr-station/bin/adsb_run.sh` — runs readsb / dump1090 for `sdr-adsb`
- `/usr/local/sbin/sdr-mode` — `status`, `set MODE`, `boot`, `restart`, `stop-all`, `current`
- `/etc/sdr/mode.env` — `MODE=fm|spectrum|detect|adsb`, restored at boot
- `/etc/sdr/adsb.env` — ADS-B gain, ppm, receiver position
- `/usr/local/sbin/sdr-maps` — offline map: `status`, `verify`, `install-local FILE`, `fetch [--build YYYYMMDD] [--force]`, `receiver LAT LON | --clear`
- `/var/lib/sdr/maps/la.pmtiles` + `la.json` — offline map tiles and their checksum/source; `/usr/local/lib/sdr-station/web/maplib/` — map library, fonts, sprites, fallback outline, licenses
- `/usr/local/lib/sdr-station/web/fonts/` — UI fonts (Anton, JetBrains Mono) and their OFL license texts
- `/var/lib/sdr-station/scope.json` — last spectrum and detect settings
- `/usr/local/sbin/sdr-net-mode` — `status`, `wifi [ssid] [password]`, `ap`, `last`, `scan`, `saved`, `ap-pass`, `log`, `boot`, `seed`
- `/usr/local/sbin/fieldnote-display-setup` — Touch Display 2 + kiosk (`--undo` to remove, `--hide-cursor` / `--show-cursor` for the kiosk pointer); `/usr/local/bin/fieldnote-kiosk` is the browser launcher it installs
- `/usr/share/icons/fieldnote-blank/`, `/usr/local/share/fieldnote-cursor/`, `/etc/systemd/system/fieldnote-kiosk.service.d/fieldnote-cursor.conf` — transparent kiosk pointer
- `/usr/local/sbin/sdr-power` — `reboot` | `poweroff` (1 s delay; used by the Power menu), `eeprom-status` | `eeprom-setup` (via `/usr/local/lib/sdr-station/bin/sdr-boot-setup`); log in `/var/log/sdr-power.log`
- `/usr/local/sbin/sdr-screen` — kiosk screen: `status`, `off`, `on`, `toggle`, `timeout`, `brightness`, `probe [--test]`, `daemon`, `notice`, `final`; settings in `/etc/sdr/screen.env`, live state in `/run/sdr-screen/state.json`, saved level in `/var/lib/sdr-screen/`; page `/screen` (`screen.html`, `screen.js`)
- `/usr/local/sbin/sdr-update` — over-the-air updates: `version`, `status`, `check [URL]`, `apply`, `apply-file FILE`, `verify-file FILE`, `set-url URL`, `get-url`, `last`; state in `/var/lib/sdr-update/`, log in `/var/log/sdr-update.log`, source in `/etc/sdr/update.env`
- `/usr/local/sbin/sdr-verify` — `verify.sh` installed (`--health [VER]` is the quick check used after an update)
- `/etc/sdr/fm.env` — live frequency, gain, Icecast password
- `/etc/sdr/stations.conf` — presets, one per line: `id|name|freq|gain|audio_rate|mp3_bitrate|highpass|lowpass|ppm`
- `/etc/sdr/net.env` — saved network mode, home profile, hotspot SSID/password (root-only)
- `/var/lib/sdr-station/net-last.json` — result of the last network switch
- `/etc/sdr/display.env` — kiosk user/URL and what `fieldnote-display-setup` changed (for `--undo`)
- `/usr/local/sbin/sdr-bt` — Bluetooth speaker + audio output: `status`, `scan`, `pair MAC`, `connect`, `disconnect`, `forget MAC`, `set-default`, `output phone|speaker|both`, `autoconnect`
- `/etc/sdr/audio.env` — `AUDIO_OUT`, `AUDIO_USER`, saved speaker `BT_MAC` / `BT_NAME`
- `/etc/wireplumber/…/80-fieldnote-headless.*` — Bluetooth audio without an active login seat
- `/var/log/sdr-bt.log` — pairing / connect / output changes
- `/var/log/sdr-net.log` — every network switch step, one `RESULT` line per switch
- `/tmp/sdr-web-net.log` — web-side network calls

Services: `sdr-fm` (stream), `sdr-spectrum` / `sdr-detect` (scope on 127.0.0.1:8081, proxied at `/api/scope/`), `sdr-adsb` (aircraft decoder), `sdr-mode` (boot restore of the dongle mode), `sdr-web` (Flask on 8080), `nginx` (port 80 proxy), `icecast2` (8000), `sdr-net` (Wi-Fi boot restore), `sdr-bt-reconnect` (reconnects the saved speaker at boot), `fieldnote-kiosk` (cage kiosk, Lite/Ubuntu), `sdr-screen` (kiosk screen off / timeout / wake), `sdr-screen-final` (backlight off as the last step of a power-off). Only one of `sdr-fm`, `sdr-spectrum`, `sdr-detect`, `sdr-adsb` runs at a time.

## If AP mode does not start

```bash
sudo apt-get install -y network-manager dnsmasq-base dnsmasq hostapd iw rfkill
sudo sdr-net-mode ap --foreground
sudo sdr-net-mode last
sudo cat /etc/sdr/net.env
tail -80 /var/log/sdr-net.log
nmcli device status
nmcli connection show --active
iw list | grep -A 12 "Supported interface modes"
```

- The adapter must list `AP` (or `AP/VLAN`). Many cheap client-only dongles cannot hotspot.
- If Ethernet is plugged in, the page will not drop when AP starts. Look for SSID `Trace` on the phone.
- Some images associate Wi-Fi outside NetworkManager. AP mode claims `wlan0` for NetworkManager, then falls back to `hostapd` + `dnsmasq`.

## Logs

- `/var/log/sdr-net.log` (`sudo sdr-net-mode last` for the latest result)
- `/tmp/sdr-web-net.log`
- `/var/log/sdr-bt.log` and `journalctl -u sdr-bt-reconnect -b` (Bluetooth speaker)
- Network page: **Show logs**
- `sudo sdr-net-mode log`
- `journalctl -u sdr-fm -u sdr-web -u sdr-net -n 80 --no-pager`
- `journalctl -u sdr-mode -u sdr-spectrum -u sdr-detect -u sdr-adsb -n 80 --no-pager`
- `usb_claim_interface error -6` in those logs means something else still holds the dongle: `sudo sdr-mode stop-all`, then `sudo sdr-mode set fm`.

## Hardware notes (Trace kit on hand)

| Item | Role |
| --- | --- |
| Raspberry Pi 4 4GB | Station computer |
| Nooelec NESDR v5 | RTL-SDR receive |
| Anker 20000 mAh | USB power bank (for now) |
| Ultimate Ears WONDERBOOM 4 | Bluetooth speaker for FM from the box (`sdr-bt`, Audio page) |
| Raspberry Pi Touch Display 2, 5″ | Local kiosk UI (`fieldnote-display-setup`) |

Not in this package: Stillwave Sweep (Pebble) GPIO bring-up, Stillwave core.


## Page layout: status strip + tab bar

Every page has a slim **status strip** pinned at the top: what the SDR is doing plus one live number
(FM frequency, aircraft count, spectrum center, detect range), the network (Wi-Fi name or hotspot), the
audio output (phone stream / speaker / both, and whether the WONDERBOOM is connected), and a power icon.
Tap a chip to open its page. The strip reads `GET /api/strip`: one small JSON built from cached helper
calls (mode 5 s, network 10 s, audio 15 s), polled every 10 s while the page is visible. Anything it
cannot read shows a dash.

The **tab bar** at the bottom (Radio · Map · Spectrum · Detect · More) only opens pages; it never changes
the SDR mode. The green dot marks the tab whose job the SDR is doing now. Tuner, Presets, Network, Audio and
Power live under **More**. The **SDR mode** row on each page still switches the dongle, as before.

## 1.0.8
See CHANGELOG.md. "/" opens the single-load app on Spectrum; tabs: Listen (FM/Airband/NOAA), Map, Scan, Spectrum, More. Installer over SSH logs to /var/log/trace-install.log; resume with `sudo bash install.sh --resume`.
