# gitgud-relay — rendezvous/relay for Git Gud peers. Zero runtime deps.
#   docker build -f deploy/relay/Dockerfile -t gitgud-relay .
#   docker run -d -p 47833:47833 -v gitgud-relay:/data gitgud-relay
# Azure Container Apps: ingress TCP 47833 (not HTTP — this is raw TLS), 0.25 vCPU is plenty.
FROM node:22-alpine AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages ./packages
COPY apps/companion/package.json ./apps/companion/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build:relay

FROM node:22-alpine
RUN adduser -D -h /data relay
USER relay
WORKDIR /data
COPY --from=build /src/out/relay/main.js /usr/local/bin/gitgud-relay
EXPOSE 47833
VOLUME ["/data"]
ENTRYPOINT ["node", "/usr/local/bin/gitgud-relay", "--data", "/data", "--json"]
