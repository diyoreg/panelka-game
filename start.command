#!/bin/bash
# Double-click to start Lost in Panelka on macOS
cd "$(dirname "$0")"
PORT=${PORT:-3001}
(sleep 1 && open "http://localhost:$PORT") &
PORT=$PORT node server.js
