FROM nginx:alpine

# Entry point (landing + login — tudo inline, sem deps externas)
COPY splash.html /usr/share/nginx/html/index.html

# Main app (dashboard)
COPY app.html /usr/share/nginx/html/app.html

# Alternate UI concepts
COPY landing.html /usr/share/nginx/html/landing.html
COPY portal.html  /usr/share/nginx/html/portal.html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
