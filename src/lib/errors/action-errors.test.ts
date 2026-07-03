import { describe, expect, it } from "vitest";

import {
  classifyProfileWriteError,
  logActionFailure,
} from "@/lib/errors/action-errors";

describe("classifyProfileWriteError", () => {
  it("maps permission denied to authorization", () => {
    expect(
      classifyProfileWriteError({
        code: "42501",
        message: "permission denied for table profiles",
      }),
    ).toBe("authorization");
  });

  it("maps missing rows to missing_profile", () => {
    expect(classifyProfileWriteError({ code: "PGRST116" })).toBe(
      "missing_profile",
    );
  });
});

describe("logActionFailure", () => {
  it("returns a development reference without leaking SQL", () => {
    const { userMessage, correlationId } = logActionFailure({
      kind: "database",
      operation: "test",
      message: 'insert into "profiles" ...',
    });
    expect(userMessage).toContain("ref:");
    expect(userMessage).not.toContain("insert into");
    expect(correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
