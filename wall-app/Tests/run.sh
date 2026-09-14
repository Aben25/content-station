#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
bin=$(mktemp -t wall-regressions)
trap 'rm -f "$bin"' EXIT
swiftc Sources/Network/Models.swift Sources/Support/Hours.swift Sources/Support/TimeFormat.swift Sources/State/StateMachine.swift Sources/State/WallState.swift Sources/Generated/Product.swift Sources/Support/Log.swift Tests/main.swift -o "$bin"
"$bin"
