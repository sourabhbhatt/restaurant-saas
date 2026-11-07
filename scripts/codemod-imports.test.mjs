import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapSpecifier, transform } from "./codemod-imports.mjs";

describe("mapSpecifier", () => {
  const cases = [
    ["@/domain/shared/money", "@ros/domain/shared/money"],
    ["@/contracts/orders", "@ros/contracts/orders"],
    ["@/server/http/route", "@ros/application/http/route"],
    ["@/server/modules/menu/ports", "@ros/application/modules/menu/ports"],
    ["@/server/container", "@/composition/container"],
    ["@/server/composition/ordering", "@/composition/ordering"],
    [
      "@/infrastructure/database/providers/postgres/client",
      "@ros/database/providers/postgres/client",
    ],
    ["@/infrastructure/database/interfaces/transaction", "@ros/database/interfaces/transaction"],
    [
      "@/infrastructure/auth/providers/local-identity",
      "@ros/adapters/auth/providers/local-identity",
    ],
    [
      "@/infrastructure/email/interfaces/email-sender",
      "@ros/adapters/email/interfaces/email-sender",
    ],
    ["@/infrastructure/logging/console-logger", "@ros/adapters/logging/console-logger"],
    ["@/infrastructure/push/providers/noop-push", "@ros/adapters/push/providers/noop-push"],
    [
      "@/infrastructure/realtime/providers/memory-bus",
      "@ros/adapters/realtime/providers/memory-bus",
    ],
    ["@/infrastructure/storage/providers/s3-storage", "@ros/adapters/storage/providers/s3-storage"],
    ["@/infrastructure/payments/providers/razorpay", "@ros/adapters/payments/providers/razorpay"],
    ["@/components/ui/button", "@ros/ui/ui/button"],
    ["@/components/shared/feedback", "@ros/ui/shared/feedback"],
    ["@/lib/api-client", "@ros/api-client"],
    ["@/lib/utils", "@ros/web-core/utils"],
    ["@/lib/query-client", "@ros/web-core/query-client"],
    ["@/features/session/queries", "@ros/web-core/features/session/queries"],
    ["@/features/navigation/profile-menu", "@ros/web-core/features/navigation/profile-menu"],
    ["@/features/notifications/queries", "@ros/web-core/features/notifications/queries"],
    ["@/features/account/account-page", "@ros/web-core/features/account/account-page"],
    ["@/features/realtime/use-branch-events", "@ros/web-core/features/realtime/use-branch-events"],
    ["@/features/offline/db", "@ros/web-core/features/offline/db"],
    // Used by two or more apps.
    ["@/features/orders/queries", "@ros/web-core/features/orders/queries"],
    ["@/features/site/status-page", "@ros/web-core/features/site/status-page"],
    // Used by exactly one app: stays app-local.
    ["@/features/menu/queries", "@/features/menu/queries"],
    ["@/features/waiter/queries", "@/features/waiter/queries"],
    ["@/test/server-only-stub", "@ros/testing/server-only-stub"],
    ["@/test/migrate-to", "@ros/testing/migrate-to"],
    ["@/test/harness", "@/test/harness"],
    ["@/app/api/v1/auth/me/route", "@/app/api/v1/auth/me/route"],
  ];
  for (const [from, to] of cases) {
    it(`${from} -> ${to}`, () => assert.equal(mapSpecifier(from), to));
  }

  it("leaves non-alias specifiers untouched", () => {
    for (const spec of [
      "react",
      "./local",
      "../up",
      "next/server",
      "zod",
      "@tanstack/react-query",
    ]) {
      assert.equal(mapSpecifier(spec), spec);
    }
  });
});

describe("transform", () => {
  it("rewrites static, re-export, dynamic, require and vi.mock forms", () => {
    const input = [
      'import { Money } from "@/domain/shared/money";',
      'import type { Order } from "@/contracts/orders";',
      'export * from "@/domain/shared/ids";',
      'export { route } from "@/server/http/route";',
      'const mod = await import("@/server/composition/ordering");',
      "const lazy = () => import('@/features/session/queries');",
      'const cjs = require("@/lib/utils");',
      'vi.mock("@/lib/api-client", () => ({}));',
      'vi.mock("@/features/waiter/queries");',
      'import { x } from "react";',
      'import y from "./sibling";',
    ].join("\n");
    const expected = [
      'import { Money } from "@ros/domain/shared/money";',
      'import type { Order } from "@ros/contracts/orders";',
      'export * from "@ros/domain/shared/ids";',
      'export { route } from "@ros/application/http/route";',
      'const mod = await import("@/composition/ordering");',
      "const lazy = () => import('@ros/web-core/features/session/queries');",
      'const cjs = require("@ros/web-core/utils");',
      'vi.mock("@ros/api-client", () => ({}));',
      'vi.mock("@/features/waiter/queries");',
      'import { x } from "react";',
      'import y from "./sibling";',
    ].join("\n");
    assert.equal(transform(input), expected);
  });

  it("does not touch strings outside import positions", () => {
    const input = 'const label = "@/domain/shared/money"; // keep\nconst s = `@/lib/utils`;';
    assert.equal(transform(input), input);
  });

  it("uses relative paths when the target is in the same package", () => {
    assert.equal(
      transform(
        'import { a } from "@/domain/shared/money";',
        "packages/domain/src/orders/pricing.ts",
      ),
      'import { a } from "../shared/money";',
    );
    assert.equal(
      transform(
        'import { a } from "@/domain/orders/order";',
        "packages/domain/src/orders/pricing.ts",
      ),
      'import { a } from "./order";',
    );
    assert.equal(
      transform(
        'import { cn } from "@/lib/utils";',
        "packages/web-core/src/features/session/auth-gate.tsx",
      ),
      'import { cn } from "../../utils";',
    );
    assert.equal(
      transform(
        'import { ApiError } from "@/lib/api-client";',
        "packages/api-client/src/query-client.ts",
      ),
      'import { ApiError } from "./index";',
    );
    // A different package keeps the package name.
    assert.equal(
      transform('import { a } from "@/domain/shared/money";', "packages/contracts/src/orders.ts"),
      'import { a } from "@ros/domain/shared/money";',
    );
  });
});
