import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored third-party worker/WASM bundles, copied verbatim out of
    // node_modules by scripts/copy-*.mjs. Linting them says nothing about this
    // codebase and they cannot be fixed without forking upstream. maplibre was
    // already listed; draco and basis arrive by exactly the same route and were
    // missed, which left `npm run lint` reporting 11 errors nobody could act on.
    
    "public/draco/**",
    "public/basis/**",
  ]),
  {
    // React Three Fiber drives animation by mutating three.js objects inside
    // useFrame (camera.position, mesh.rotation, instance matrices). That is
    // the documented, correct way to animate in R3F — going through React
    // state would re-render every frame — but the React Compiler immutability
    // rules read it as illegal mutation. Scope those rules off the 3D code.
    files: ["src/components/**/*.tsx"],
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["src/lib/backend/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // removeChannel() is banned here, and the reason is a whole paragraph in
      // supabase.ts at detachChannel(). Short version: it awaits a leave that
      // can take ten seconds, during which `client.channel(topic)` — a
      // singleton per topic — keeps handing the dying channel to whoever
      // remounts next. The client that adopts it goes permanently deaf while
      // its own sends fall back to REST and look fine.
      //
      // It is one autocomplete away from coming back, and nothing in the
      // harness can catch it: every journey runs demo mode or ?net=local, so
      // this file is never executed by a test. A lint rule is the only guard
      // available, so it is an error rather than a warning.
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='removeChannel']",
          message:
            "Use detachChannel() — removeChannel() leaves the channel adoptable for up to 10 s and closes the shared socket. See the comment on detachChannel in supabase.ts.",
        },
      ],
    },
  },
]);

export default eslintConfig;
