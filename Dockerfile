FROM nginx:alpine

# Splash screen becomes the entry point
COPY splash.html /usr/share/nginx/html/index.html
COPY splash.css  /usr/share/nginx/html/splash.css
COPY splash.js   /usr/share/nginx/html/splash.js

# Main app accessible at /app.html
COPY app.html /usr/share/nginx/html/app.html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
