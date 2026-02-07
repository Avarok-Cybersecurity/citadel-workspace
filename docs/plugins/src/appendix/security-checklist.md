# Security Checklist for Plugin Developers

Before publishing a plugin:

- [ ] Request only capabilities actually needed
- [ ] Handle all errors gracefully (no crashes)
- [ ] Sanitize user input before rendering
- [ ] Don't store sensitive data in plugin storage
- [ ] Use capability-scoped paths for filesystem access
- [ ] Validate network responses before processing
- [ ] Implement proper cleanup in shutdown handler
- [ ] Test with resource limits enabled
- [ ] Document all capabilities and why they're needed
- [ ] Provide clear privacy policy if collecting data
