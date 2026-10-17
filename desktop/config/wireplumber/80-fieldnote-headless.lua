-- Stillwave Trace (WirePlumber 0.4, Ubuntu 24.04 / Debian 12):
-- keep Bluetooth audio working for a lingering user without an active login seat
-- (headless Pi, or before the kiosk session starts).
bluez_monitor.properties["with-logind"] = false
