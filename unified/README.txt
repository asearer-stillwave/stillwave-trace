Stillwave Trace 1.3.8 - one package for both editions

  sudo bash /home/<you>/trace-1.3.8/install.sh
      asks:  1) Handheld (5" touch display)
             2) Desktop (HDMI)
  sudo bash /home/<you>/trace-1.3.8/install.sh --display dsi     handheld, no question
  sudo bash /home/<you>/trace-1.3.8/install.sh --display hdmi    desktop, no question
  sudo bash /home/<you>/trace-1.3.8/install.sh --upgrade         keeps this box's edition, no question

common/    files both editions share
handheld/  handheld-only files (5" touch display)
desktop/   desktop-only files (HDMI)
The installer copies common/ + the chosen edition to /var/lib/sdr-station/stage/1.3.8-<edition>/ and runs that
edition's install.sh. Release notes: handheld/CHANGELOG.md and desktop/CHANGELOG.md.
No map tiles in this zip: an installed /var/lib/sdr/maps/la.pmtiles is kept; a fresh install with internet downloads it.
