.ONESHELL:

VERSION ?= $(shell git rev-parse --short HEAD)
APP_NAME ?= circle-bot

docker-start:
	docker-compose up

docker-rebuild:
	docker-compose down && \
	docker-compose build && \
	docker-compose up

docker-reinitialize:
	docker-compose down -
