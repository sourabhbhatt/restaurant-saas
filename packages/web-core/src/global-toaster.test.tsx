import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountPage } from "./features/account/account-page";
import { sessionKeys } from "./features/session/queries";
import { GlobalToaster, toastPosition } from "./global-toaster";

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/account",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  // Sonner follows the system colour scheme.
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("toastPosition", () => {
  it("keeps each area's placement from one global container", () => {
    expect(toastPosition("/kitchen/b1", "top-right")).toBe("bottom-center");
    for (const p of ["/t/abc", "/sign-in", "/sign-up", "/invite/x", "/waiter/b1", "/cashier/b1"]) {
      expect(toastPosition(p, "top-right")).toBe("top-center");
    }
    expect(toastPosition("/app/b/b1/settings", "top-right")).toBe("top-right");
    expect(toastPosition("/", "top-center")).toBe("top-center");
    // Prefixes match whole segments only.
    expect(toastPosition("/tables", "top-right")).toBe("top-right");
  });
});

describe("GlobalToaster", () => {
  it("shows toasts on a page that has no container of its own (account settings)", async () => {
    const me = {
      user: { id: "u1", email: "p@example.in", name: "Priya", emailVerified: true },
      activeWorkspaceId: null,
      workspaces: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          // The save refreshes the account afterwards.
          new Response(JSON.stringify({ data: String(url).includes("/auth/me") ? me : {} }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    qc.setQueryData(sessionKeys.me, me);
    render(
      <QueryClientProvider client={qc}>
        <GlobalToaster />
        <AccountPage />
      </QueryClientProvider>,
    );
    const name = await screen.findByLabelText(/Full name/);
    await userEvent.clear(name);
    await userEvent.type(name, "Priya Sharma");
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByText("Profile updated")).toBeInTheDocument();
  });
});

/** Every `<Toaster` in app and package sources (tests and build output excluded). */
function toasterMounts(): string[] {
  const root = path.resolve(__dirname, "../../..");
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) {
        if (readFileSync(full, "utf8").includes("<Toaster")) found.push(path.relative(root, full));
      }
    }
  };
  for (const base of ["apps", "packages"]) walk(path.join(root, base));
  return found.sort();
}

describe("toast container", () => {
  it("is mounted once per app, by AppProviders, so no toast shows twice", () => {
    expect(toasterMounts()).toEqual(["packages/web-core/src/global-toaster.tsx"]);
  });
});
