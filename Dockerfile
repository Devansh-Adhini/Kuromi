FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 \
    libgl1-mesa-dri xvfb x11vnc novnc websockify openbox dbus-x11 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
COPY assets ./assets
COPY --chmod=755 docker-start.sh /usr/local/bin/kuromi-start

ENV DISPLAY=:99 KUROMI_USER_DATA=/data KUROMI_CONTAINER=1
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 6080
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/kuromi-start"]
