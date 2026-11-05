#!/bin/sh
# Render the image-owned Nginx template before the backend starts.

http_port="${GS_HTTP_PORT-7000}"

invalid_port() {
    echo "ERROR: GS_HTTP_PORT must be an integer from 1 to 65535 other than 7001"
    exit 1
}

case "$http_port" in
    ''|0*|*[!0-9]*) invalid_port ;;
esac
if [ "${#http_port}" -gt 5 ] || [ "$http_port" -gt 65535 ] ||
   [ "$http_port" -eq 7001 ]; then
    invalid_port
fi

# Render ANSI escapes here because Nginx does not decode shell-style escape codes.
# Colors stay in literal log-format text so request variables keep their safe escaping.
log_escape="$(printf '\033')"

# Both replacements are controlled values; no persistent config is needed in the data volume.
if ! sed -e "s/@GS_HTTP_PORT@/$http_port/g" -e "s/@GS_LOG_ESC@/$log_escape/g" \
    /app/ground-station.conf.template > /etc/nginx/conf.d/ground-station.conf; then
    echo "ERROR: Failed to render Nginx configuration"
    exit 1
fi

if ! nginx -t; then
    echo "ERROR: Nginx configuration is invalid"
    exit 1
fi
