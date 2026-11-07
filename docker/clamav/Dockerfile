# ClamAV 1.4.3 with a small HTTP wrapper. Build-time freshclam bakes a
# signature set; the entrypoint runs freshclam again before clamd starts.
FROM clamav/clamav:1.4.3

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends nodejs \
  && freshclam --foreground --stdout || true \
  && rm -rf /var/lib/apt/lists/*

COPY server.js /opt/scan/server.js
COPY entrypoint.sh /opt/scan/entrypoint.sh
RUN chmod 755 /opt/scan/entrypoint.sh

ENV CLAMD_PORT=3310
EXPOSE 8080
ENTRYPOINT ["/opt/scan/entrypoint.sh"]
