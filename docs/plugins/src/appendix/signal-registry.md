# Signal Type Registry

Standard signal types that plugins should use for interoperability:

```yaml
# Infrastructure
infrastructure.alert.critical
infrastructure.alert.warning
infrastructure.alert.info
infrastructure.status.healthy
infrastructure.status.degraded
infrastructure.status.down

# Incidents
incident.created
incident.assigned
incident.escalated
incident.resolved
incident.closed

# Build/Deploy
build.started
build.succeeded
build.failed
deploy.started
deploy.succeeded
deploy.failed
deploy.rollback

# Workspace
workspace.member.joined
workspace.member.left
workspace.content.updated
workspace.settings.changed

# Plugin
plugin.installed
plugin.uninstalled
plugin.error
plugin.health.degraded
```
