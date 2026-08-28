#!/usr/bin/env bash
# Deploy gitgud-relay to Azure Container Apps with a public TCP port and a
# persistent /data volume (the relay's TLS key + bound host tokens live there;
# losing them changes the fingerprint every host and phone has pinned).
#
#   az login
#   ./deploy/relay/azure.sh                 # defaults below, override with env vars
#   RG=my-rg LOCATION=westeurope NAME=gitgud-relay ./deploy/relay/azure.sh
#
# Prints the relay address to paste into Git Gud (Settings → Reachable via
# relay) and into the daemon config ("rendezvous"). Re-running updates the image.
set -euo pipefail
RG="${RG:-gitgud-relay-rg}"; LOCATION="${LOCATION:-westeurope}"; NAME="${NAME:-gitgud-relay}"
ENV_NAME="${ENV_NAME:-$NAME-env}"; STORAGE="${STORAGE:-$(echo "${NAME//-/}store$RANDOM" | cut -c1-24)}"
PORT=47833; IMAGE="${IMAGE:-}"; ACR="${ACR:-}"

command -v az >/dev/null || { echo "az CLI required: https://learn.microsoft.com/cli/azure/install-azure-cli" >&2; exit 1; }
az extension add --name containerapp --upgrade --only-show-errors >/dev/null

echo "▸ resource group $RG ($LOCATION)"
az group create -n "$RG" -l "$LOCATION" --only-show-errors >/dev/null

if [ -z "$IMAGE" ]; then
  ACR="${ACR:-$(echo "${NAME//-/}acr$RANDOM" | cut -c1-40)}"
  echo "▸ container registry $ACR + build image from this repo"
  az acr create -g "$RG" -n "$ACR" --sku Basic --admin-enabled true --only-show-errors >/dev/null
  az acr build -r "$ACR" -t "gitgud-relay:latest" -f deploy/relay/Dockerfile . --only-show-errors
  IMAGE="$ACR.azurecr.io/gitgud-relay:latest"
fi

echo "▸ environment $ENV_NAME"
az containerapp env create -g "$RG" -n "$ENV_NAME" -l "$LOCATION" --only-show-errors >/dev/null 2>&1 || true

echo "▸ persistent storage for /data ($STORAGE)"
az storage account create -g "$RG" -n "$STORAGE" -l "$LOCATION" --sku Standard_LRS --only-show-errors >/dev/null 2>&1 || true
KEY=$(az storage account keys list -g "$RG" -n "$STORAGE" --query '[0].value' -o tsv)
az storage share create --name relaydata --account-name "$STORAGE" --account-key "$KEY" --only-show-errors >/dev/null
az containerapp env storage set -g "$RG" -n "$ENV_NAME" --storage-name relaydata --azure-file-account-name "$STORAGE" --azure-file-account-key "$KEY" --azure-file-share-name relaydata --access-mode ReadWrite --only-show-errors >/dev/null

echo "▸ container app $NAME (TCP ingress $PORT)"
REG_ARGS=()
if [ -n "$ACR" ]; then REG_ARGS=(--registry-server "$ACR.azurecr.io" --registry-username "$(az acr credential show -n "$ACR" --query username -o tsv)" --registry-password "$(az acr credential show -n "$ACR" --query 'passwords[0].value' -o tsv)"); fi
if az containerapp show -g "$RG" -n "$NAME" --only-show-errors >/dev/null 2>&1; then
  az containerapp update -g "$RG" -n "$NAME" --image "$IMAGE" --only-show-errors >/dev/null
else
  az containerapp create -g "$RG" -n "$NAME" --environment "$ENV_NAME" --image "$IMAGE" "${REG_ARGS[@]}" \
    --ingress external --transport tcp --target-port $PORT --exposed-port $PORT \
    --min-replicas 1 --max-replicas 1 --cpu 0.25 --memory 0.5Gi --only-show-errors >/dev/null
  # Mount the file share at /data (yaml patch — the CLI has no flag for volumes).
  TMP=$(mktemp); az containerapp show -g "$RG" -n "$NAME" -o yaml > "$TMP"
  python3 - "$TMP" <<'PY'
import sys, yaml
p = sys.argv[1]; d = yaml.safe_load(open(p))
t = d['properties']['template']
t['volumes'] = [{'name': 'data', 'storageType': 'AzureFile', 'storageName': 'relaydata'}]
for c in t['containers']: c['volumeMounts'] = [{'volumeName': 'data', 'mountPath': '/data'}]
yaml.safe_dump(d, open(p, 'w'))
PY
  az containerapp update -g "$RG" -n "$NAME" --yaml "$TMP" --only-show-errors >/dev/null; rm -f "$TMP"
fi

FQDN=$(az containerapp show -g "$RG" -n "$NAME" --query properties.configuration.ingress.fqdn -o tsv)
echo "▸ waiting for the relay to log its fingerprint…"
for i in $(seq 1 30); do
  LINE=$(az containerapp logs show -g "$RG" -n "$NAME" --tail 50 --only-show-errors 2>/dev/null | grep -o '"address":"relay://[^"]*"' | tail -1 || true)
  [ -n "$LINE" ] && break; sleep 5
done
FP=$(echo "$LINE" | sed -n 's/.*#\([0-9A-F]*\)".*/\1/p')
echo
echo "Relay is up:  relay://$FQDN:$PORT${FP:+#$FP}"
echo "  • Desktop: Settings → Share with other Git Gud instances → Reachable via relay → paste the address above"
echo "  • Daemon : \"rendezvous\": { \"url\": \"relay://$FQDN:$PORT${FP:+#$FP}\", \"token\": \"$(openssl rand -hex 24)\" }   then: gitgud-headless reload"
echo "  • Phones learn the route automatically the next time they reach a host that has it."
[ -n "$FP" ] || echo "  (fingerprint not visible in logs yet — run: az containerapp logs show -g $RG -n $NAME --tail 50 | grep address)"
