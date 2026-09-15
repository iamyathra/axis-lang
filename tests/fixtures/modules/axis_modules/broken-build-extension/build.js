// Deliberately broken - modules.test.js checks this fails with a clear
// AxisModuleError, not an unhandled exception crashing resolveModules'
// caller with a raw, unrelated-looking stack trace.
throw new Error("boom");
