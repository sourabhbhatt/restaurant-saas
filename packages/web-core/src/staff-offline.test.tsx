import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const register = vi.fn(async () => undefined);
const providerProps: Record<string, unknown>[] = [];
const runtimeMounts = vi.fn();

vi.mock("@serwist/turbopack/react", () => ({
  SerwistProvider: (props: Record<string, unknown> & { children: React.ReactNode }) => {
    providerProps.push(props);
    return props.children;
  },
  useSerwist: () => ({ serwist: { register } }),
}));

vi.mock("./features/offline/components/offline-runtime", () => ({
  OfflineRuntime: () => {
    runtimeMounts();
    return null;
  },
}));

beforeEach(() => {
  // The toaster (sonner) follows the system colour scheme.
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  register.mockClear();
  runtimeMounts.mockClear();
  providerProps.length = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AppProviders", () => {
  it("never registers the service worker or starts the offline runtime by itself", async () => {
    const { AppProviders } = await import("./app-providers");
    render(
      <AppProviders>
        <p>page</p>
      </AppProviders>,
    );
    expect(providerProps).toHaveLength(1);
    expect(providerProps[0]!.register).toBe(false);
    expect(register).not.toHaveBeenCalled();
    expect(runtimeMounts).not.toHaveBeenCalled();
  });
});

describe("StaffOffline", () => {
  it("registers the service worker once and starts the offline runtime", async () => {
    const { StaffOffline } = await import("./staff-offline");
    const first = render(<StaffOffline />);
    first.unmount();
    // Another staff layout mounting it later (client navigation) does not register again.
    render(<StaffOffline />);
    expect(register).toHaveBeenCalledTimes(1);
    expect(runtimeMounts).toHaveBeenCalledTimes(2);
  });

  it("tries again on a later mount when registration failed", async () => {
    register.mockRejectedValueOnce(new Error("blocked"));
    const { StaffOffline } = await import("./staff-offline");
    const first = render(<StaffOffline />);
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    first.unmount();
    render(<StaffOffline />);
    expect(register).toHaveBeenCalledTimes(2);
  });
});
