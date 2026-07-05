.PHONY: dist dist-opencode dist-voxcode web web-server web-app desktop clean help

BUN ?= bun
ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))

WEB_PORT ?= 3000
SERVER_PORT ?= 4096

VOXCODE_OS := $(shell uname -s | sed 's/Darwin/darwin/;s/Linux/linux/;s/MINGW.*/windows/;s/MSYS.*/windows/;s/CYGWIN.*/windows/' | tr '[:upper:]' '[:lower:]')
VOXCODE_ARCH := $(shell uname -m | sed 's/aarch64/arm64/;s/x86_64/x64/')
VOXCODE_DIST := packages/voxcode/dist/voxcode-$(VOXCODE_OS)-$(VOXCODE_ARCH)

VOXCODE_BUILD_FLAGS := --single
ifneq ($(SKIP_OPENCODE),)
VOXCODE_BUILD_FLAGS += --skip-opencode
endif

help:
	@echo "Vox Code distribution"
	@echo
	@echo "  make dist              build opencode + voxcode for this machine"
	@echo "  make web               run the web app locally (server + app dev servers, hot reload)"
	@echo "  make web-server        run just the opencode server + voice sidecar"
	@echo "  make web-app           run just the web app dev server"
	@echo "  make desktop           run the desktop (Electron) app locally with hot reload"
	@echo "  make clean             remove local dist artifacts"
	@echo
	@echo "Optional:"
	@echo "  SKIP_OPENCODE=1 make dist        reuse the last opencode binary"
	@echo "  WEB_PORT=3000 SERVER_PORT=4096   override web/app and server ports"

dist-opencode:
ifneq ($(SKIP_OPENCODE),)
	@echo "→ skipping opencode (SKIP_OPENCODE=1)"
else
	@echo "→ building opencode"
	$(BUN) run --cwd $(ROOT)packages/opencode build --single
endif

dist-voxcode:
	@echo "→ building voxcode bundle"
	$(BUN) run --cwd $(ROOT)packages/voxcode build $(VOXCODE_BUILD_FLAGS)

dist: dist-opencode dist-voxcode
	@test -x "$(ROOT)$(VOXCODE_DIST)/bin/voxcode"
	@test -x "$(ROOT)$(VOXCODE_DIST)/bin/opencode"
	@echo
	@echo "dist ready: $(VOXCODE_DIST)"
	@echo
	@echo "  export PATH=\"$(abspath $(ROOT)$(VOXCODE_DIST)/bin):\$$PATH\""
	@echo "  export XAI_API_KEY=\"xai-…\""
	@echo "  voxcode tui ."
	@echo "  voxcode web"

# Local web dev loop: the opencode server (hosts the voice sidecar) + the app's vite dev server
# with hot reload. Open http://localhost:$(WEB_PORT) and connect it to http://localhost:$(SERVER_PORT).
# Voice needs XAI_API_KEY exported in this shell (the sidecar runs inside the server).
web-server:
	@echo "→ opencode server + voice sidecar on http://localhost:$(SERVER_PORT)"
	@if [ -z "$$XAI_API_KEY" ]; then echo "  ! XAI_API_KEY not set — voice will be disabled"; fi
	$(BUN) run --cwd $(ROOT)packages/opencode --conditions=browser ./src/index.ts serve --port $(SERVER_PORT) --cors http://localhost:$(WEB_PORT)

web-app:
	@echo "→ web app dev server on http://localhost:$(WEB_PORT)"
	$(BUN) run --cwd $(ROOT)packages/app dev --port $(WEB_PORT)

web:
	@echo "→ web app locally: server :$(SERVER_PORT) + app :$(WEB_PORT)"
	@echo "  open http://localhost:$(WEB_PORT), then connect to http://localhost:$(SERVER_PORT)"
	@if [ -z "$$XAI_API_KEY" ]; then echo "  ! XAI_API_KEY not set — voice will be disabled"; fi
	@echo
	@trap 'kill 0' EXIT INT TERM; \
		$(BUN) run --cwd $(ROOT)packages/opencode --conditions=browser ./src/index.ts serve --port $(SERVER_PORT) --cors http://localhost:$(WEB_PORT) & \
		$(BUN) run --cwd $(ROOT)packages/app dev --port $(WEB_PORT) & \
		wait

# Desktop (Electron) app. The main process spawns its own embedded opencode server (with the voice
# sidecar), so no separate server is needed — predev builds it. Voice needs XAI_API_KEY in this shell.
desktop:
	@echo "→ desktop (Electron) app with hot reload"
	@if [ -z "$$XAI_API_KEY" ]; then echo "  ! XAI_API_KEY not set — voice will be disabled"; fi
	@# bun skips Electron's postinstall, so the binary may be missing after install. Fetch it once.
	@if [ ! -f "$(ROOT)packages/desktop/node_modules/electron/path.txt" ]; then \
		echo "→ downloading Electron binary (first run)"; \
		$(BUN) $(ROOT)packages/desktop/node_modules/electron/install.js; \
	fi
	$(BUN) run --cwd $(ROOT)packages/desktop dev

clean:
	rm -rf $(ROOT)packages/voxcode/dist
	rm -rf $(ROOT)packages/opencode/dist/opencode-$(VOXCODE_OS)-$(VOXCODE_ARCH)
