# ClamAV 1.4.3 with a small HTTP wrapper (server.js), for Cloud Run.
# clamav/clamav is the Alpine image; clamav/clamav-debian is the Debian one. Alpine is used
# because its nodejs package is a supported Node release, where Debian 12's apt package is
# Node 18 (end of life). The non-"_base" tag already contains the signature databases.
FROM clamav/clamav:1.4.3

USER root

# Its own step, with nothing that can hide a failure: no Node, no image.
RUN apk add --no-cache nodejs
RUN node --version

# clamd listens on 127.0.0.1:3310 only, logs to the container output (Foreground with no
# LogFile prints to stdout), and does not try to switch user, because it never runs as root.
# The grep checks fail the build if the image's config no longer has these lines.
RUN set -eux \
  && conf=/etc/clamav/clamd.conf \
  && sed -i -E \
       -e 's|^#?TCPSocket .*|TCPSocket 3310|' \
       -e 's|^#?TCPAddr .*|TCPAddr 127.0.0.1|' \
       -e 's|^#?Foreground .*|Foreground yes|' \
       -e 's|^LogFile .*|#LogFile disabled: clamd logs to stdout|' \
       -e 's|^User .*|#User disabled: the container runs as clamav|' \
       "$conf" \
  && grep -qx 'TCPSocket 3310' "$conf" \
  && grep -qx 'TCPAddr 127.0.0.1' "$conf" \
  && ! grep -q '^LogFile ' "$conf" \
  && ! grep -q '^User ' "$conf" \
  && sed -i -E 's|^UpdateLogFile .*|#UpdateLogFile disabled: freshclam logs to stdout|' /etc/clamav/freshclam.conf \
  && ls /var/lib/clamav/main.c?d /var/lib/clamav/daily.c?d \
  && install -d -o clamav -g clamav -m 775 /run/clamav \
  && chown -R clamav:clamav /var/lib/clamav

COPY server.js /opt/scan/server.js
COPY entrypoint.sh /opt/scan/entrypoint.sh
RUN chmod 755 /opt/scan/entrypoint.sh

USER clamav
ENV CLAMD_PORT=3310
EXPOSE 8080
ENTRYPOINT ["/opt/scan/entrypoint.sh"]
