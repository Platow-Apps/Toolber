// ESM resolve hook: redirect `src/lib/supabaseClient.js` to the test double.
//
// The app imports a module-level Supabase singleton, which would otherwise try
// to build a real client (and read `import.meta.env`) the moment any page module
// is loaded. Swapping the module at resolution time keeps the source untouched.

const DOUBLE = new URL("./supabase-double.js", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (resolved.url.includes("/src/lib/supabaseClient")) {
    return { ...resolved, url: DOUBLE, shortCircuit: true };
  }
  return resolved;
}
