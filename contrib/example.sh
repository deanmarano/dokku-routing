#!/usr/bin/env bash
# Example drop-in for /var/lib/dokku/data/routing/contrib/.
#
# Copy this file, rename it, and replace the bodies. It is sourced in a
# subshell, so it may not assume anything about the caller's state beyond the
# helpers in the routing plugin's `functions` file.

# Capabilities this plugin imposes on one app.
# Emit: <capability-key><TAB><detail><TAB><source>
contrib_app_capabilities() {
  local app="$1"

  # Nothing to say about apps this plugin does not touch.
  dokku sso:report "$app" 2>/dev/null | grep -q 'Sso protected: *true' || return 0

  printf 'forward-auth\tprotected by dokku-sso\tsso:protect\n'
}

# Proxies this plugin itself supports.
# Emit: <plugin><TAB><proxy><TAB><full|partial|none><TAB><note>
contrib_proxy_support() {
  printf 'sso\tnginx\tfull\tauth_request via nginx-pre-reload\n'
  printf 'sso\ttraefik\tnone\tno forwardAuth wiring yet\n'
}
