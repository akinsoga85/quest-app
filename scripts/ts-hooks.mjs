// Lets the database tests import the contract's TypeScript straight from
// source: Node strips the types, and this adds the ".ts" the contract's
// extensionless relative imports leave out.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    if (e?.code === "ERR_MODULE_NOT_FOUND" && /^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return next(`${specifier}.ts`, context);
    }
    throw e;
  }
}
