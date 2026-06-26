.PHONY: dist dist-opencode dist-voxcode clean help

BUN ?= bun
ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))

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
	@echo "  make clean             remove local dist artifacts"
	@echo
	@echo "Optional:"
	@echo "  SKIP_OPENCODE=1 make dist   reuse the last opencode binary"

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

clean:
	rm -rf $(ROOT)packages/voxcode/dist
	rm -rf $(ROOT)packages/opencode/dist/opencode-$(VOXCODE_OS)-$(VOXCODE_ARCH)
