#!/bin/sh
# Deploy tv-home to the TV: build + check, ship a fresh copy of the server (keeping learned state), boot hook,
# and the launcher IPK.
#
# Set TV to the TV's SSH destination (root over SSH, as set up by the webOS Homebrew Channel) and, if needed, SSH_KEY:
#   TV=root@192.0.2.20 SSH_KEY=~/.ssh/id_ed25519 ./deploy.sh
set -e
cd "$(dirname "$0")"
TV=${TV:-root@lgtv.lan}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/id_ed25519}
SSH="ssh -o BatchMode=yes -i $SSH_KEY -o IdentitiesOnly=yes"

(cd server && npm run check && npm run build)

IPK=$(python3 build_ipk.py /tmp/tvhome-launcher.ipk)
# A new directory each time, so files removed from the repo don't linger on the TV. state/ and logs/ carry over.
tar -C server -cf - dist public data config.json | $SSH $TV 'rm -rf /home/root/tv-home.new && mkdir -p /home/root/tv-home.new && tar -C /home/root/tv-home.new -xf -'
$SSH $TV 'cat > /home/root/tv-home.ipk' < "$IPK"
$SSH $TV 'cat > /home/root/tvctl.sh && chmod 755 /home/root/tvctl.sh' < tv/tvctl.sh
$SSH $TV 'cat > /var/lib/webosbrew/init.d/55-debloat && chmod 755 /var/lib/webosbrew/init.d/55-debloat' < tv/init.d/55-debloat
$SSH $TV 'sh -s' <<'EOF'
set -e
mkdir -p /home/root/tv-home/state /home/root/tv-home/logs
mv /home/root/tv-home/state /home/root/tv-home.new/state
mv /home/root/tv-home/logs /home/root/tv-home.new/logs
rm -rf /home/root/tv-home.old
mv /home/root/tv-home /home/root/tv-home.old
mv /home/root/tv-home.new /home/root/tv-home
cat > /var/lib/webosbrew/init.d/70-tvhome <<'HOOK'
#!/bin/sh
# Start the tv-home launcher service (localhost only).
pkill -f /home/root/tv-home/ 2>/dev/null
pkill -f '^luna-send -i ' 2>/dev/null # subscriptions left by a crashed server
sleep 1
setsid node /home/root/tv-home/dist/server.cjs </dev/null >/tmp/tvhome.log 2>&1 &
HOOK
chmod 755 /var/lib/webosbrew/init.d/70-tvhome
/var/lib/webosbrew/init.d/70-tvhome </dev/null >/dev/null 2>&1
/home/root/tvctl.sh luna://com.webos.appInstallService/dev/install '{"id":"org.tvhome.launcher","ipkUrl":"/home/root/tv-home.ipk","subscribe":false}'
EOF
