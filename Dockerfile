FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node server ./server
COPY --chown=node:node \
  index.html \
  styles.css \
  desire-observatory.css \
  peel-game-refined.css \
  app.js \
  analysis-stages.js \
  budget-goals.js \
  budget-whiteboard.js \
  desire-observatory.js \
  gachapon-motion.js \
  gesture-controls.js \
  gesture-recognizer.worker.js \
  gesture-ui.js \
  goal-date-picker.js \
  intro-transition.js \
  orientation-controls.js \
  orientation-ui.js \
  panorama.js \
  peel-copy-catalog.js \
  peel-game.js \
  peel-game-ui.js \
  peel-product-visuals.js \
  peel-gesture-controls.js \
  persona-presentations.js \
  route-sync.js \
  scene-config.js \
  personality-scoring.js \
  share-poster.js \
  ./
COPY --chown=node:node assets ./assets

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/api/health >/dev/null || exit 1

CMD ["node", "server.mjs"]
