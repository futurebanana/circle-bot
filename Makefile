.ONESHELL:

VERSION ?= $(shell git rev-parse --short HEAD)
APP_NAME ?= circle-bot

all: lint build test deploy

build:
	@echo "Building the project..."
	npm install
	npm run build

test:
	@echo "Running tests..."
	npm test

lint:
	@echo "Linting the code..."
	pre-commit run --all-files

login:
	@echo "Logging in to Heroku..."
	heroku login

deploy:
	@echo "Deploying to Heroku..."
	git add .
	git commit -m "Deploying version $(VERSION)"
	git push heroku main

scale:
	@echo "Scaling up the Heroku app..."
	heroku ps:scale web=0 worker=1:Basic

logs:
	@echo "Fetching logs from Heroku..."
	heroku logs --tail
