# Gotenberg 8.40.0 is the final 8.x release. Basic auth is enabled with
# GOTENBERG_API_BASIC_AUTH_USERNAME and GOTENBERG_API_BASIC_AUTH_PASSWORD.
# https://gotenberg.dev/docs/8.x/configuration
FROM gotenberg/gotenberg:8.40.0

USER root
RUN set -eux \
  && . /etc/os-release \
  && echo "deb http://deb.debian.org/debian ${VERSION_CODENAME} contrib" > /etc/apt/sources.list.d/contrib.list \
  && echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections \
  && apt-get update \
  && apt-get install -y --no-install-recommends ttf-mscorefonts-installer fontconfig \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/*

USER gotenberg
# The base image starts gotenberg under tini, which reaps the LibreOffice and Chromium
# child processes. Keep tini when setting the command line.
ENTRYPOINT ["/usr/bin/tini", "--", "gotenberg"]
CMD ["--api-port-from-env=PORT", "--api-enable-basic-auth", "--api-timeout=60s", "--libreoffice-restart-after=10"]
