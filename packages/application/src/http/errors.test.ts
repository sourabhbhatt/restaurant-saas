import { describe, expect, it } from "vitest";

import { DomainError } from "@ros/domain/shared/errors";

import { isUnavailableError, toErrorResponse } from "./errors";

const withCode = (code: string, message = "boom") => Object.assign(new Error(message), { code });

describe("isUnavailableError", () => {
  it("recognises socket-level failures and Postgres connection SQLSTATEs", () => {
    for (const code of ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "08006", "53300", "57P01"]) {
      expect(isUnavailableError(withCode(code))).toBe(true);
    }
  });

  it("recognises pg's code-less connection failures by their exact messages", () => {
    for (const message of [
      "Connection terminated unexpectedly",
      "Connection terminated",
      "Connection terminated due to connection timeout",
      "timeout exceeded when trying to connect",
      "Client has encountered a connection error and is not queryable",
      "Client was closed and is not queryable",
    ]) {
      expect(isUnavailableError(new Error(message)), message).toBe(true);
    }
    // Only exact driver strings, never anything that merely contains them.
    expect(isUnavailableError(new Error("user said: Connection terminated"))).toBe(false);
  });

  it("treats a cancelled statement (statement_timeout, 57014) and server shutdowns as unavailability", () => {
    for (const code of ["57014", "57P01", "57P02", "57P03"]) {
      expect(isUnavailableError(withCode(code))).toBe(true);
    }
  });

  it("looks through cause chains and AggregateError members", () => {
    expect(isUnavailableError(new Error("wrapped", { cause: withCode("ECONNREFUSED") }))).toBe(
      true,
    );
    expect(isUnavailableError(new AggregateError([withCode("ECONNREFUSED")], "all failed"))).toBe(
      true,
    );
  });

  it("does not treat ordinary errors, constraint violations or domain errors as unavailability", () => {
    expect(isUnavailableError(new Error("TypeError-ish"))).toBe(false);
    expect(isUnavailableError(withCode("23505"))).toBe(false);
    expect(isUnavailableError(withCode("42501"))).toBe(false);
    expect(isUnavailableError(new DomainError("NOT_FOUND", "x"))).toBe(false);
    expect(isUnavailableError(null)).toBe(false);
    expect(isUnavailableError("ECONNREFUSED")).toBe(false);
  });

  it("survives cyclic causes", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b", { cause: a });
    a.cause = b;
    expect(isUnavailableError(a)).toBe(false);
  });
});

describe("toErrorResponse", () => {
  it("maps unavailability to a 503 with a retry hint and no internals", () => {
    const { status, body } = toErrorResponse(
      withCode("ECONNREFUSED", "connect ECONNREFUSED 10.0.0.5:5432"),
      "req-1",
    );
    expect(status).toBe(503);
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(body.error.details).toEqual({ retryAfterSeconds: 5 });
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
    expect(body.error.requestId).toBe("req-1");
  });

  it("keeps unknown errors as a generic 500", () => {
    const { status, body } = toErrorResponse(new Error("secret path /srv/x"), "req-2");
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("/srv/x");
  });
});
