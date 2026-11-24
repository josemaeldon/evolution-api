#! /bin/bash
set -e

cd evolution-manager-v2
if git apply --check ../manager/chat-header.patch; then
  git apply ../manager/chat-header.patch
elif ! git apply --reverse --check ../manager/chat-header.patch; then
  echo "Manager chat patch does not apply to this submodule revision" >&2
  exit 1
fi
npm install
npm run build
cd ..
rm -rf manager/dist
cp -r evolution-manager-v2/dist manager/dist
node manager/localize-assets.mjs
