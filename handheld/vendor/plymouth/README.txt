Plymouth for Raspberry Pi OS (Debian 13 trixie, arm64), installed offline by bin/sdr-splash when plymouth is missing.
From deb.debian.org trixie main (checksums matched the signed Packages index on 2026-10-25):
  plymouth + libplymouth5 24.004.60-5 (GPL-2.0-or-later), libevdev2 1.13.4 (MIT)
Source: https://packages.debian.org/source/trixie/plymouth . Only used on trixie/arm64; Ubuntu uses its own apt.
1.3.6: libxkbcommon0 and xkb-data are no longer bundled. Raspberry Pi OS already ships newer ones (libwlroots-0.20 / cage need
libxkbcommon0 >= 1.8.0); installing Debian's 1.7.0 over them broke apt. sdr-splash never downgrades an installed package.
