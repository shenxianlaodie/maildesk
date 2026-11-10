#!/bin/sh
set -eu

# Serialize deployments with scoped release retention.
exec 9>/run/maildesk-maintenance.lock
flock -x 9
docker build -t maildesk:path /opt/maildesk/app
previous="maildesk-before-path-$(date +%s)"
docker stop maildesk
docker rename maildesk "$previous"
if docker run -d --init --name maildesk --restart unless-stopped --memory=1g --memory-reservation=128m --memory-swap=1g --cpus=1 --pids-limit=100 --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m --cap-drop=ALL --security-opt=no-new-privileges --log-driver=json-file --log-opt max-size=10m --log-opt max-file=3 --env-file /opt/maildesk/.env -e MAILDESK_PUBLIC_ORIGIN=https://chat.thinkpro.top -e MAILDESK_BASE_PATH=/maildesk --mount type=bind,source=/opt/maildesk/data,target=/data --mount type=volume,source=chatwoot-docker_mabang-bridge-data,target=/legacy,readonly -e LEGACY_ORDER_DATABASE_PATH=/legacy/stores.sqlite -p 127.0.0.1:4175:4175 -p 127.0.0.1:4182:4182 maildesk:path; then
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
