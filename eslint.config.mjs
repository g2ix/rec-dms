import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import tailwindcss from "eslint-plugin-tailwindcss";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".next-e2e/**",
      "test-results/**",
      "playwright-report/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "docker/**",
      "deploy/**",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { tailwindcss },
    settings: {
      tailwindcss: {
        cssConfigPath: "src/app/globals.css",
        functions: ["cn", "cva"],
      },
    },
    rules: {
      "tailwindcss/no-custom-classname": "off",
      "tailwindcss/no-arbitrary-value": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "lucide-react",
              importNames: [
                "Loader",
                "Loader2",
                "LoaderCircle",
                "LoaderPinwheel",
                "LoaderIcon",
                "Loader2Icon",
                "LoaderCircleIcon",
              ],
              message: "Do not use spinners. Use BlurLoad, BusyButton, or ProgressRow.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/animate-spin/]",
          message: "Do not use spinners.",
        },
        {
          selector: "TemplateElement[value.raw=/animate-spin/]",
          message: "Do not use spinners.",
        },
      ],
    },
  },
];

export default eslintConfig;
