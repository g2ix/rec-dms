FROM gotenberg/gotenberg:8

USER root
RUN echo "deb http://deb.debian.org/debian bookworm contrib" >> /etc/apt/sources.list \
  && echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections \
  && apt-get update \
  && apt-get install -y --no-install-recommends ttf-mscorefonts-installer \
  && rm -rf /var/lib/apt/lists/*
USER gotenberg
