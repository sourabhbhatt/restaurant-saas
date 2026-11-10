import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BRAND } from "./brand";

const repo = path.resolve(import.meta.dirname, "../../../../..");

function sources(dir: string): { file: string; text: string }[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => path.join(dir, file))
    .map((file) => ({ file: path.relative(repo, file), text: readFileSync(file, "utf8") }));
}

const appSources = [
  ...sources(path.join(repo, "packages/web-core/src")),
  ...["console", "ops", "admin"].flatMap((app) => sources(path.join(repo, `apps/${app}/src`))),
];

describe("support email and legal entity are runtime settings", () => {
  it("are not part of the build-time BRAND constant", () => {
    expect(BRAND).not.toHaveProperty("supportEmail");
    expect(BRAND).not.toHaveProperty("legalEntity");
  });

  it("are never read from NEXT_PUBLIC_* variables (those are fixed when the image is built)", () => {
    const offenders = appSources
      .filter(({ text }) =>
        /NEXT_PUBLIC_(SUPPORT_EMAIL|LEGAL_ENTITY)|BRAND\.(supportEmail|legalEntity)/.test(text),
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("are rendered only by server components (client bundles cannot read them)", () => {
    const offenders = appSources
      .filter(({ text }) => /^["']use client["']/m.test(text) && /site-contact/.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
