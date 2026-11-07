FROM postgres:17-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gzip rclone \
  && rm -rf /var/lib/apt/lists/*

COPY backup.sh /backup.sh
RUN chmod 755 /backup.sh

ENTRYPOINT ["/backup.sh"]
