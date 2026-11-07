#!/bin/sh
set -eu

if [ -f /etc/clamav/clamd.conf ]; then
  if ! grep -q '^TCPSocket ' /etc/clamav/clamd.conf; then
    printf '\nTCPSocket 3310\nTCPAddr 127.0.0.1\n' >> /etc/clamav/clamd.conf
  fi
fi

# Signatures baked at build time are refreshed on start. A failure here
# still leaves the image's database in place.
freshclam --foreground --stdout || true

clamd --foreground &
exec node /opt/scan/server.js
