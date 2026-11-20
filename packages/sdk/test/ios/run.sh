#!/bin/sh
# Builds the iOS core with its tests for the Mac and runs them. Needs Xcode (or its command line tools).
set -e
cd "$(dirname "$0")/../.."
out="${TMPDIR:-/tmp}/shipstat-ios-tests"
xcrun swiftc -swift-version 5 -O \
  ios/ShipstatCore.swift ios/EventStore.swift ios/Gzip.swift \
  test/ios/TestServer.swift test/ios/main.swift \
  -lsqlite3 -o "$out"
"$out"
