import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams("token_hash=test-token&type=recovery"),
}));

vi.mock("@/features/authentication/hooks/use-recovery-tab-leader", () => ({
  useRecoveryTabLeader: () => "leader",
}));

import { AuthRecoveryInterstitial } from "@/features/authentication/components/auth-recovery-interstitial";

describe("AuthRecoveryInterstitial", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/features/authentication/components/auth-recovery-interstitial.tsx",
    ),
    "utf8",
  );

  it("does not use window.open or target=_blank", () => {
    expect(source).not.toMatch(/window\.open/i);
    expect(source).not.toMatch(/target\s*=\s*["']_blank["']/i);
  });

  it("submits recovery verification via POST form", () => {
    render(<AuthRecoveryInterstitial />);

    const form = screen
      .getByRole("button", {
        name: /continue to reset password/i,
      })
      .closest("form");
    expect(form).toHaveAttribute("action", "/auth/confirm");
    expect(form).toHaveAttribute("method", "POST");
    expect(form?.querySelector('input[name="token_hash"]')).toHaveAttribute(
      "value",
      "test-token",
    );
    expect(form?.querySelector('input[name="type"]')).toHaveAttribute(
      "value",
      "recovery",
    );
  });

  it("disables Continue immediately after submit", async () => {
    const user = userEvent.setup();
    render(<AuthRecoveryInterstitial />);

    const button = screen.getByRole("button", {
      name: /continue to reset password/i,
    });
    await user.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(/continuing/i);
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});
