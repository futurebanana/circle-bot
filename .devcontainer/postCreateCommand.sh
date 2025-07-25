#!/bin/bash
# This script is run after the container is created.
set -e

sudo apt update
sudo apt install -y shellcheck jq

pip3 install -r requirements.txt

pre-commit install

curl https://cli-assets.heroku.com/install.sh | sh
