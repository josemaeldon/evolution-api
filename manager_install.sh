#! /bin/bash
set -e

cd evolution-manager-v2
npm ci
VITE_BASE_PATH=/manager/ npm run build
cd ..
rm -rf manager/dist
cp -r evolution-manager-v2/dist manager/dist
node manager/localize-assets.mjs
