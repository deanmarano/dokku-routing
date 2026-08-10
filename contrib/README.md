# Declaring routing capabilities from another plugin

`dokku-routing` has no special cases for any plugin. If your plugin changes how
traffic reaches an app -- an SSO plugin adding forward auth, a WAF plugin adding
rate limiting, anything that writes proxy config -- it tells `routing` in its own
terms and shows up in reports, plans and the summary automatically.

There are two channels. Use the trigger if you control the plugin; use the
drop-in if you do not.

## Channel 1: plugn triggers (preferred)

Drop an executable named after the trigger at the root of your plugin.

### `routing-app-capabilities <app>`

Emit one tab-separated line per capability your plugin causes this app to use:

```
<capability-key>	<detail>	<source>
```

`capability-key` must come from `lib/capabilities` in this repo. `detail` is
whatever a human needs to see (a value, a path, a rule). `source` is what to
blame -- usually your command namespace.

```bash
#!/usr/bin/env bash
set -eo pipefail
APP="$1"
dokku sso:report "$APP" 2>/dev/null | grep -q 'Sso protected: *true' || exit 0
printf 'forward-auth\tprotected by Authelia\tsso:protect\n'
printf 'vendor-settings\tbypass paths configured\tsso:bypass\n'
```

Emitting nothing for an unaffected app is correct and expected.

### `routing-proxy-support`

Emit which proxies your plugin itself works with. No arguments.

```
<plugin>	<proxy>	<full|partial|none>	<note>
```

```bash
#!/usr/bin/env bash
printf 'sso\tnginx\tfull\tauth_request via the nginx-pre-reload hook\n'
printf 'sso\ttraefik\tfull\tforwardAuth middleware\n'
printf 'sso\tcaddy\tnone\tno Caddy integration yet\n'
```

This is what makes `routing:plan myapp traefik` able to say that moving the app
would also require moving your plugin's integration -- without `routing` knowing
your plugin exists.

## Channel 2: drop-in files

For plugins you cannot modify, put a shell file in
`/var/lib/dokku/data/routing/contrib/`. It is sourced in a subshell and may
define either function:

```bash
# /var/lib/dokku/data/routing/contrib/my-plugin.sh
contrib_app_capabilities() {
  local app="$1"
  ...
}

contrib_proxy_support() {
  ...
}
```

The output format is identical to the triggers. See `example.sh` in this
directory for a working file you can copy.
