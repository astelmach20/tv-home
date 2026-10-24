#!/bin/sh
# usage: tvctl.sh <luna uri> [json] [extra luna-send flags...] ; prints the JSON reply
# luna-send drops its output when stdout is a pipe, so the reply goes through a temp file. deploy.sh installs this as
# /home/root/tvctl.sh; deploy.sh and the MCP server's screenshot tool call it there.
u=$1; p=${2:-"{}"}; shift 2 2>/dev/null
o=$(mktemp); luna-send -n 1 "$@" "$u" "$p" >"$o" 2>&1 </dev/null; cat "$o"; rm -f "$o"
