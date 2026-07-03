import { describe, expect, it } from "vitest";

import { sameOriginRecoveryPath } from "@/lib/auth/recovery-path";

describe("sameOriginRecoveryPath", () => {
  it("returns a same-tab app path for valid recovery URLs", () => {
    expect(
      sameOriginRecoveryPath(
        "http://localhost:3000/auth/recovery?token_hash=abc123&type=recovery",
      ),
    ).toBe("/auth/recovery?token_hash=abc123&type=recovery");
  });

  it("rejects verify URLs and other paths", () => {
    expect(
      sameOriginRecoveryPath(
        "http://127.0.0.1:54321/auth/v1/verify?token=abc&type=recovery",
      ),
    ).toBeNull();
    expect(
      sameOriginRecoveryPath("https://evil.example.com/auth/recovery"),
    ).toBeNull();
  });
});
