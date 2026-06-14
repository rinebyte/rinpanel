FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    nginx \
    certbot \
    python3-certbot-nginx \
    curl \
    openssh-server \
    sudo \
    procps \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir /var/run/sshd \
    && echo 'root:panel123' | chpasswd \
    && sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config

RUN mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
COPY nginx-default.conf /etc/nginx/sites-available/default
RUN ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default

# Themed page served when a request hits an unbound (unknown) domain.
# Stored outside /var/www so the docker-compose volume mount doesn't mask it.
RUN mkdir -p /usr/share/rinpanel
COPY unbound.html /usr/share/rinpanel/unbound.html

EXPOSE 22 80 443
CMD service ssh start && nginx -g 'daemon off;'
