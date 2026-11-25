#! /bin/bash
set -e

cd evolution-manager-v2
npm ci
npm run build
cd ..
rm -rf manager/dist
cp -r evolution-manager-v2/dist manager/dist
node manager/localize-assets.mjs
