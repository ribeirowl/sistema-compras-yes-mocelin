# Stage 1: build Vite app
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: serve with nginx
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html/app
COPY --from=builder /app/index.html   /usr/share/nginx/html/index.html
COPY --from=builder /app/portal.html  /usr/share/nginx/html/portal.html
COPY --from=builder /app/app.html     /usr/share/nginx/html/app.html
COPY --from=builder /app/splash.html  /usr/share/nginx/html/splash.html
COPY --from=builder /app/splash.css   /usr/share/nginx/html/splash.css
COPY --from=builder /app/splash.js    /usr/share/nginx/html/splash.js
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
