#!/bin/bash
# Builds and deploys the RiverPay contracts to Stellar testnet.
# Requires: stellar CLI (https://developers.stellar.org/docs/tools/cli) and a
# funded identity: stellar keys generate deployer --network testnet --fund
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
SOURCE="${SOURCE:-deployer}"

cd "$(dirname "$0")/.."
stellar contract build

for wasm in target/wasm32-unknown-unknown/release/*.wasm; do
  name=$(basename "$wasm" .wasm)
  echo "Deploying $name..."
  id=$(stellar contract deploy --wasm "$wasm" --source "$SOURCE" --network "$NETWORK")
  echo "$name: $id"
done
