#!/bin/sh
set -eu
docker build -t maildesk:path /opt/maildesk/app
previous="maildesk-before-path-$(date +%s)"
docker stop maildesk
docker rename maildesk "$previous"
if docker run -d --name maildesk --restart unless-stopped --memory=512m --memory-reservation=128m --memory-swap=512m --cpus=0.5 --pids-limit=100 --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m --cap-drop=ALL --security-opt=no-new-privileges --log-driver=json-file --log-opt max-size=10m --log-opt max-file=3 --env-file /opt/maildesk/.env -e MAILDESK_PUBLIC_ORIGIN=https://chat.thinkpro.top -e MAILDESK_BASE_PATH=/maildesk -e LEGACY_ORDER_DATABASE_PATH=/legacy/stores.sqlite --mount type=bind,source=/var/lib/docker/volumes/chatwoot-docker_mabang-bridge-data/_data,target=/legacy,readonly --mount type=bind,source=/opt/maildesk/data,target=/data -p 127.0.0.1:4175:4175 -p 127.0.0.1:4182:4182 maildesk:path; then
    attempt=0
    while test "$attempt" -lt 40; do
        if test "$(docker inspect --format '{{.State.Health.Status}}' maildesk)" = healthy; then
            echo MAILDESK_HEALTHY
            exit 0
        fi
        attempt=$((attempt + 1))
        sleep 1
    done
fi
docker rm -f maildesk || true
docker rename "$previous" maildesk
docker start maildesk
exit 1
