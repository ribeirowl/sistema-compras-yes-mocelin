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
COPY splash.html /usr/share/nginx/html/index.html
COPY --from=builder /app/dist /usr/share/nginx/html/app
COPY landing.html /usr/share/nginx/html/landing.html
COPY portal.html  /usr/share/nginx/html/portal.html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
