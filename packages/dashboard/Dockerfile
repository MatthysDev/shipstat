# Build from the repository root:
#   docker build -t shipstat-dashboard -f packages/dashboard/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter shipstat-dashboard... && pnpm --filter shipstat-dashboard build

FROM nginx:alpine
COPY --from=build /repo/packages/dashboard/dist /usr/share/nginx/html
RUN printf 'types { application/wasm wasm; }\n' > /etc/nginx/conf.d/wasm.types
EXPOSE 80
