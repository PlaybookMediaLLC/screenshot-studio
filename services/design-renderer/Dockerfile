# Chromium and its system libraries come with the Playwright image, pinned to
# the same Playwright version as package.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.mjs ./
ENV NODE_ENV=production PORT=8080
USER pwuser
EXPOSE 8080
CMD ["node", "server.mjs"]
