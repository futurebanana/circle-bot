.ONESHELL:

VERSION ?= $(shell git rev-parse --short HEAD)
APP_NAME ?= circle-bot

login:
	@echo "Logging in to Heroku..."
	heroku login

deploy:
	@echo "Deploying to Heroku..."
	git push heroku main

scale:
	@echo "Scaling the Heroku app..."
	heroku ps:scale worker=1:Basic

logs:
	@echo "Fetching logs from Heroku..."
	heroku logs --tail
