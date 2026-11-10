import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sessionKeys } from "../session/queries";
import { WorkspaceSettingsPage } from "./workspace-settings-page";

const WS = "11111111-1111-4111-8111-111111111111";
vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceId: WS }) }));

const workspace = {
  id: WS,
  name: "Sharma Foods",
  legalName: null,
  businessEmail: null,
  businessPhone: null,
  taxId: null,
  country: "IN",
  version: 3,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WorkspaceSettingsPage", () => {
  it("refreshes cached branch contexts after a rename (they carry the workspace name)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ data: { ...workspace, name: "Sharma Hospitality", version: 4 } }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
      ),
    );
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    qc.setQueryData(["workspace", WS, "detail"], {
      workspace,
      membership: { permissions: ["workspace.update"] },
    });
    qc.setQueryData(sessionKeys.branchContext("b1"), { workspaceName: "Sharma Foods" });
    qc.setQueryData(sessionKeys.branchContext("b2"), { workspaceName: "Sharma Foods" });
    qc.setQueryData(["branch", "b1", "settings"], { unrelated: true });
    render(
      <QueryClientProvider client={qc}>
        <WorkspaceSettingsPage />
      </QueryClientProvider>,
    );

    const name = await screen.findByLabelText(/Workspace name/);
    await userEvent.clear(name);
    await userEvent.type(name, "Sharma Hospitality");
    await userEvent.click(screen.getByRole("button", { name: "Save workspace details" }));

    const state = (key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated;
    await waitFor(() => expect(state(sessionKeys.branchContext("b1"))).toBe(true));
    expect(state(sessionKeys.branchContext("b2"))).toBe(true);
    expect(state(["branch", "b1", "settings"])).toBe(false);
  });
});
