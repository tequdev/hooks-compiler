// Plain JS so tsc's rewriteRelativeImportExtensions does not wrap the argument in a helper call,
// which would hide the magic comments from bundlers (Turbopack then replaces the import with a
// "too dynamic" error). `url` is absolute; the comments tell Vite, webpack and Turbopack to leave it alone.
export const importUrl = (url) => import(/* @vite-ignore */ /* webpackIgnore: true */ /* turbopackIgnore: true */ url);
