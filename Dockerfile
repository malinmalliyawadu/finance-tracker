# Self-hosted image for Coolify. Next.js standalone output, so the runtime
# layer carries only the traced dependencies rather than a full node_modules.
#
# Note: the only network the builder needs is the registry for `npm ci`. The
# fonts are committed under src/fonts and loaded with next/font/local, so
# nothing reaches out to fonts.gstatic.com mid-build. The runtime needs no
# network beyond the database and Akahu.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# `--network=none` is a guard, not an optimisation. A production deploy once
# failed because next/font/google fetches its files during `next build` and
# fonts.gstatic.com was unreachable from the builder. The fonts are committed
# now (src/fonts), and this line means any future build-time fetch fails here,
# in a build anyone can run, rather than intermittently on the deploy server.
RUN --network=none npm run build

FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S ledger && adduser -S ledger -G ledger

COPY --from=builder --chown=ledger:ledger /app/.next/standalone ./
COPY --from=builder --chown=ledger:ledger /app/.next/static ./.next/static

# The migration runner, the seeds and the sync jobs all ship with the image:
# migrations run on boot (see CMD), the rest run as Coolify scheduled tasks
# inside this same image. Node 24 runs the TypeScript directly.
COPY --from=builder --chown=ledger:ledger /app/db ./db
COPY --from=builder --chown=ledger:ledger /app/scripts ./scripts
COPY --from=builder --chown=ledger:ledger /app/src ./src
COPY --from=builder --chown=ledger:ledger /app/data ./data

# The standalone build bundles postgres.js into the server chunks rather than
# leaving it in node_modules, so the scripts above — which import it directly at
# runtime — cannot resolve it. Copy the one package back in. It has no
# dependencies of its own, so this is the whole fix.
COPY --from=deps --chown=ledger:ledger /app/node_modules/postgres ./node_modules/postgres

USER ledger
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Apply pending migrations, then serve. Coolify provides DATABASE_URL.
#
# On boot rather than as a separate step, because the alternative is a deploy
# that succeeds while the schema the new code expects is not there yet: the
# image ships and the pages that need the new table 500 until someone
# remembers. `&&` means a failed migration stops the container from serving at
# all, which is the honest outcome. The runner is idempotent, so a restart that
# migrates nothing costs one query.
CMD ["sh", "-c", "node scripts/migrate.ts && node server.js"]
