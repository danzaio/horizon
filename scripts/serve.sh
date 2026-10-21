#!/bin/sh
# usage: scripts/serve.sh <dir> <port>  -> background static server that survives the shell
cd "$1" && (setsid nohup python3 -m http.server "$2" --bind 127.0.0.1 > /dev/null 2>&1 < /dev/null &)
