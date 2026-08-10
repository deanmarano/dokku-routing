# dokku-routing

Audit and plan migrations between Dokku proxy implementations.

This is not an nginx-to-Traefik converter. It is a portability framework: every
routing concern is modelled as a **capability**, each proxy declares how well it
supports each capability, and every app is measured against that model. Adding a
proxy means adding one file. Nothing in the plugin knows about specific proxy
pairs.

`proxy:*` is Dokku core configuring the proxy you use. `routing:*` analyses and
compares the proxies you *could* use.

## Install

```
dokku plugin:install https://github.com/deanmarano/dokku-routing.git routing
```

## Commands

```
dokku routing                            portability summary for every app
dokku routing:report <app>               detailed proxy analysis for one app
dokku routing:plan <app> <target-proxy>  migration plan for moving an app
dokku routing:list                       installed and available proxies
dokku routing:compare <proxy> <proxy>    capability matrix for two proxies
```

`routing`, `routing:report`, `routing:list` and `routing:compare` accept
`--format json`. `routing:plan` is text only.

A `routing:migrate` command is deliberately absent. The model has to prove itself
on real apps before anything in this plugin is allowed to change them.

## What it inspects

For each app: the current proxy, domains, port mappings, TLS certificates and
ACME, zero-downtime deploy checks, proxy settings (`nginx:set`, `traefik:set`),
Traefik labels attached through `docker-options`, custom templates
(`nginx.conf.sigil`, `nginx.conf.d/*.conf`), and anything other installed
plugins declare about the app's routing.

Custom proxy config is detected but **never parsed**. Its presence is the
finding; what it does is for a human to read.

## Classification

Every capability an app uses is graded against the target proxy:

| | Meaning |
|---|---|
| ✅ Portable | Dokku core owns this state. It survives the proxy swap untouched. |
| 🔄 Auto-translatable | A real setting the target supports, spelled differently. |
| ⚠ Manual migration required | The target's support is partial, or the config is opaque to us. |
| ❌ Unsupported | The target proxy has no equivalent. |

The grade falls out of two facts: how the target adapter grades the capability
(`full` / `partial` / `none`), and who owns the capability's state in the
registry (`dokku` / `proxy` / `opaque`). There is no per-pair logic anywhere.

```
$ dokku routing
APP                      PROXY        CAPS CUSTOM   CAN MOVE TO
---                      -----        ---- ------   -----------
blog                     nginx           6 no       caddy, haproxy, openresty, traefik
dashboard                nginx          14 yes      caddy

Blocked moves
-------------
  dashboard                ❌ haproxy, openresty, traefik
```

```
$ dokku routing:plan dashboard traefik
=====> Migration plan: dashboard  nginx -> traefik

✅ Portable (5)
   Domains / virtual hosts         dashboard.example.com (domains)
   ...

⚠  Manual migration required (4)
   Request body size limit         client-max-body-size=10m (nginx:set)
                                   -> traefik: buffering middleware, with different semantics
   ...

❌ Unsupported (1)
   Hand-written proxy config       /home/dokku/dashboard/nginx.conf.sigil (custom template)
                                   -> traefik: no equivalent to a hand-written vhost template

Verdict
-------
  Blocked. traefik has no equivalent for 1 capability this app relies on.
```

## Architecture

```
lib/capabilities     the capability registry -- every routing concern, named once
providers/<proxy>    one adapter per proxy: capability grades, optional detector
functions            adapter loading, detection, classification, output helpers
subcommands/         one file per command
contrib/             how other plugins declare their own routing capabilities
```

### Proxy adapters

An adapter is a sourced bash file declaring metadata and one required function:

```bash
PROXY_NAME="traefik"
PROXY_DESCRIPTION="Dynamic, container-aware routing driven by labels and middleware"
PROXY_DOKKU_PLUGIN="traefik-vhosts"
PROXY_INSPECTION="full"          # or "metadata"

proxy_capabilities() {           # <capability>\t<full|partial|none>\t<note>
  ...
}

proxy_detect() {                 # optional; <capability>\t<detail>\t<source>
  local app="$1"
  routing_detect_common "$app"    # shared: domains, ports, TLS, deploy checks
  ...
}
```

`nginx` and `traefik` ship with detectors. `caddy`, `haproxy` and `openresty`
declare their capability matrices only, which is enough for `routing:compare`,
`routing:plan` and the summary to treat them as real targets. Adding a detector
later requires no changes elsewhere.

Adapters are sourced in subshells, so several can be interrogated in one run
without their functions colliding.

### A note on cost

Auditing a fleet means asking Dokku the same questions for every app, and the
obvious implementation is slow enough to be useless — 40 apps took over a
minute. Three things fix it, and all three are easy to undo by accident:

- **Bulk reports.** `dokku <plugin>:report` with no app returns every app in
  one call. The summary pre-warms a cache; single-app commands fetch only what
  they need.
- **Single-field reports.** `ports:report` inspects each app's image to compute
  its detected ports — 11.9s across 40 apps, against 0.13s for `--ports-map`,
  which is the only part we want. Same for `domains`. In bulk these print one
  bare line per app in `apps:list` order, so the positional mapping is trusted
  only when the line count matches the app count, falling back to full reports
  otherwise.
- **Not forking.** Every `$(...)` is a fork, and classification runs thousands
  of times. `routing_classify` avoids command substitution internally and
  publishes `ROUTING_CLASS` so hot loops can read a variable instead.

The same subtlety bites all three: command substitution is a subshell, so a
cache filled inside `$( )` is discarded. Caches are warmed by calling the
function directly, in the caller's shell, and detectors — which do run in
subshells — inherit them read-only.

Together: 102s to 9.7s for a 40-app summary, 2.4s to 1.0s for one app.

### Other plugins

A plugin that changes routing -- an SSO plugin adding forward auth, say --
declares that itself, through a `routing-app-capabilities` plugn trigger or a
drop-in file in `/var/lib/dokku/data/routing/contrib/`. Those capabilities then
flow through reports, plans and the summary exactly like a proxy's own, with no
special cases. See [contrib/README.md](contrib/README.md).

## Development

```
make deps         install test dependencies
make lint         shellcheck
make test-docker  boot a throwaway Dokku in Docker and test against it
make test         test against whatever Dokku the environment points at
make install      install into the local Dokku
```

Tests are TypeScript under vitest and need a real Dokku. They create and destroy
apps named `routing-*` and write files under `/home/dokku/routing-*/`, so point
them at something disposable:

| | |
|---|---|
| `make test-docker` | boots `dokku/dokku` in Docker and drives it with `docker exec` (what CI runs) |
| `DOKKU_CONTAINER=name npm test` | an existing Dokku container |
| `DOKKU_HOST=my-host npm test` | a remote Dokku over SSH |
| `DOKKU_USE_SUDO=true npm test` | the local `dokku` binary |

`make test-docker` mounts the host Docker socket into the Dokku container. Run it
on a disposable machine, not one hosting anything you care about.
