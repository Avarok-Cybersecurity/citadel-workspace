# MDX Component Convention

Plugins should follow these conventions for MDX components:

```typescript
// Component naming: PascalCase, namespaced
// Good: "MyPlugin.StatusWidget"
// Bad: "status-widget", "statusWidget"

// Props should be documented
interface StatusWidgetProps {
  /** Server ID to display status for */
  serverId: string;
  /** Refresh interval in seconds */
  refreshInterval?: number;
  /** Show detailed metrics */
  detailed?: boolean;
}

// Components should handle loading/error states
function StatusWidget({ serverId, refreshInterval = 30 }: StatusWidgetProps) {
  const { data, loading, error } = useServerStatus(serverId, refreshInterval);

  if (loading) return <Skeleton />;
  if (error) return <Alert variant="error">{error.message}</Alert>;

  return <StatusDisplay status={data} />;
}
```
