// Registers the Supabase resolve hook. Wired in via ava's `nodeArguments`
// (`--import=./test/support/mock-supabase.mjs`) so it is installed before any
// test file — and therefore any app module — is loaded.
import { register } from "node:module";

register("./supabase-resolve-hook.mjs", import.meta.url);
