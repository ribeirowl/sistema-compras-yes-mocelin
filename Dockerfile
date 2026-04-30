FROM nginx:alpine

# Splash screen — entry point
COPY splash.html /usr/share/nginx/html/index.html
COPY splash.css  /usr/share/nginx/html/splash.css
COPY splash.js   /usr/share/nginx/html/splash.js

# Main app
COPY app.html /usr/share/nginx/html/app.html

# Alternate UI concepts
COPY landing.html /usr/share/nginx/html/landing.html
COPY portal.html  /usr/share/nginx/html/portal.html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
