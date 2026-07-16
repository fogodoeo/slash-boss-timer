FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    BAND_CHROME_EXECUTABLE=/usr/bin/chromium \
    BAND_CHROME_PROFILE_DIR=/var/data/band-chrome-profile \
    BAND_MONITOR_STATE_FILE=/var/data/band-join-monitor-state.json \
    BAND_MONITOR_LOG_FILE=/var/data/band-join-monitor.log \
    BAND_MONITOR_STATUS_FILE=/var/data/band-monitor-runtime.json \
    BAND_MONITOR_ENABLED=true \
    BAND_CHROME_HEADLESS=true \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        chromium \
        dumb-init \
        fonts-noto-cjk \
        python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN mkdir -p /var/data

EXPOSE 10000

ENTRYPOINT ["dumb-init", "--"]
CMD ["python3", "render_start.py"]
