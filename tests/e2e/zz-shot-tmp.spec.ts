import { test } from "@playwright/test";
test.setTimeout(90_000);
test("shots", async ({ page }, info) => {
  const tag = info.project.name;
  for (const [p, name] of [["/", "home"], ["/pricing", "pricing"], ["/sign-up", "signup"]] as const) {
    await page.goto(p);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "/tmp/claude-0/-home-user-restaurant-saas/6d8d1e6e-cca5-5a6b-81bd-6a4889bb0a31/scratchpad/" + name + "-" + tag + ".png", fullPage: name !== "signup" });
  }
});
