# More Examples

## Project Management Hub

**Vision**: Workspace rooms as project boards with:
- Kanban/Scrum boards
- Sprint planning
- Time tracking
- Integration with GitHub/GitLab

```yaml
plugins:
  - id: "com.citadel.kanban-board"
    capabilities: [ui:components, mdx:edit, domain:write]

  - id: "com.citadel.github-integration"
    capabilities: [network:connect, signals:emit, ui:panels]
    config:
      repos: ["org/project-alpha", "org/project-beta"]

  - id: "com.citadel.sprint-planner"
    capabilities: [domain:write, members:read, signals:emit]

  - id: "com.citadel.time-tracker"
    capabilities: [domain:write, ui:panels]
```

## Customer Support Center

**Vision**: Workspace as a support ticketing system with:
- Ticket queue management
- Customer chat integration
- Knowledge base (MDX content)
- SLA tracking

```yaml
plugins:
  - id: "com.citadel.ticket-queue"
    capabilities: [ui:panels, signals:subscribe, domain:write]

  - id: "com.citadel.customer-chat"
    capabilities: [messages:send, network:connect, ui:panels]

  - id: "com.citadel.knowledge-base"
    capabilities: [mdx:edit, ui:components]

  - id: "com.citadel.sla-monitor"
    capabilities: [signals:subscribe, signals:emit, ui:components]
```
