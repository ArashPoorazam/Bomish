FROM node:26.12.1-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV API_URL=http://api:8080 NEXT_TELEMETRY_DISABLED=1
RUN npm run build
FROM node:26.12.1-alpine
# The standalone server only needs Node; omit unused package managers and their dependencies.
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn-* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
