FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
ARG NPM_REGISTRY
RUN if [ -n "$NPM_REGISTRY" ]; then npm ci --registry "$NPM_REGISTRY"; else npm ci; fi
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
# BACKEND_HOST allows runtime override of the nginx proxy target.
# Default: backend:8000 (Docker Compose). Railway sets this to the private domain.
CMD ["/bin/sh", "-c", "if [ -n \"$BACKEND_HOST\" ]; then sed -i \"s|backend:8000|$BACKEND_HOST|g\" /etc/nginx/conf.d/default.conf; fi && exec nginx -g 'daemon off;'"]
