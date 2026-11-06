#!/bin/sh
set -eu

Xvfb "$DISPLAY" -screen 0 1024x768x24 -nolisten tcp &
sleep 1
openbox &
x11vnc -display "$DISPLAY" -localhost -nopw -forever -shared -rfbport 5900 &
websockify --web /usr/share/novnc 6080 127.0.0.1:5900 &
exec dbus-run-session -- ./node_modules/.bin/electron . --no-sandbox
