.PHONY: help deps test test-integration lint install

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

deps: ## Install test dependencies
	npm install

test: test-integration ## Run all tests

test-integration: ## Run integration tests (requires a Dokku host)
	npm run test:integration

lint: ## Run shellcheck on the plugin scripts
	shellcheck -x commands config install functions lib/capabilities contrib/example.sh
	find subcommands providers -type f -exec shellcheck -x {} +

install: ## Install the plugin into Dokku
	sudo mkdir -p /var/lib/dokku/plugins/available/router
	sudo cp -r plugin.toml config commands install functions lib providers subcommands /var/lib/dokku/plugins/available/router/
	sudo ln -sf /var/lib/dokku/plugins/available/router /var/lib/dokku/plugins/enabled/router
	sudo dokku plugin:install-dependencies router || true
