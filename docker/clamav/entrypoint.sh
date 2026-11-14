#!/bin/sh
# Runs as the clamav user. clamd.conf is set at build time (127.0.0.1:3310, logs to stdout).
set -eu

# Start clamd with the signature databases baked into the image. Startup does not wait
# for the network.
clamd --foreground &

# Refresh the signatures once, in the background, after clamd answers PING with the baked
# set loaded, so the two do not load the database at the same time. freshclam notifies
# clamd to reload. Any failure leaves the baked databases in use.
(
  clamdscan --ping 300:1 >/dev/null 2>&1 || true
  freshclam --foreground --stdout \
    || echo "freshclam failed; scanning with the signatures in the image." >&2
) &

# server.js starts listening only after clamd answers PING, and /health returns 503
# whenever clamd stops answering.
exec node /opt/scan/server.js
