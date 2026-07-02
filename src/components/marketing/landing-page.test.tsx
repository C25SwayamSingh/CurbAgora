import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LandingPage } from "@/components/marketing/landing-page";

describe("LandingPage", () => {
  it("renders customer and vendor value propositions", () => {
    render(<LandingPage />);

    expect(
      screen.getByRole("heading", { name: /For customers/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /For vendors/i }),
    ).toBeInTheDocument();
  });

  it("renders primary call-to-action buttons", () => {
    render(<LandingPage />);

    expect(screen.getByRole("link", { name: /Find Vendors/i })).toHaveAttribute(
      "href",
      "/discover",
    );
    expect(
      screen.getByRole("link", { name: /List Your Business/i }),
    ).toHaveAttribute("href", "/vendors/list");
  });
});
