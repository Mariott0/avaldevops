FROM nginx:1.28-alpine

WORKDIR /usr/share/nginx/html

COPY nginx.conf /etc/nginx/nginx.conf
COPY index.html styles.css theme.js app.js favicon.svg ./

USER nginx

EXPOSE 8080

# Bypass the image's root-oriented initialization scripts.
ENTRYPOINT ["nginx", "-g", "daemon off;"]
