AIS-catcher is NOT bundled. bin/sdr-ais-fix builds it on the box when a dongle first gets the AIS role (needs internet once).
Source: https://github.com/jvde-github/AIS-catcher  tag v0.70  commit 8833c64b3da0c42e9a724b9bd13eaab2fffadcca
Build: cmake .. -DCMAKE_BUILD_TYPE=Release && make (deps: git build-essential cmake pkg-config librtlsdr-dev zlib1g-dev)
Installed: /usr/local/bin/AIS-catcher (binary only) + LICENSE in /usr/local/share/doc/ais-catcher/
License: GPL-3.0 (separate program, run as its own process, not linked). Built and replay-tested on x86_64 for 1.3.1; arm64 build untested.
