import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const publishLoyaltyProgramActionMock = vi.fn();

vi.mock("@/features/loyalty/actions", () => ({
  publishLoyaltyProgramAction: (...args: unknown[]) =>
    publishLoyaltyProgramActionMock(...args),
}));

import { LoyaltyConsultation } from "@/features/loyalty/components/loyalty-consultation";

const ORG = "org-1";

/** Fill the minimum viable consultation for a sustainable free-item card. */
async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Typical order total"), "12");
  await user.type(screen.getByLabelText("Which item?"), "Horchata");
  await user.type(screen.getByLabelText("Menu price"), "3.50");
  await user.selectOptions(costModeSelect(), "known");
  await user.type(screen.getByLabelText("What it costs you to make"), "0.90");
}

/** The mode selector for the reward-cost field (exists in every mode). */
function costModeSelect() {
  return screen.getByLabelText(
    /What it costs you to make — how would you like to answer\?/i,
  );
}

function getRecommendations() {
  return screen.getByRole("heading", { name: /Recommended programs/i });
}

describe("LoyaltyConsultation", () => {
  beforeEach(() => {
    publishLoyaltyProgramActionMock.mockReset();
    publishLoyaltyProgramActionMock.mockResolvedValue({ status: "idle" });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("says what will happen before asking for anything", () => {
    render(
      <LoyaltyConsultation organizationId={ORG} hasActiveProgram={false} />,
    );
    expect(screen.getByText(/Reward recommender/i)).toBeInTheDocument();
    // The three steps, in the owner's terms rather than the system's.
    expect(screen.getByText(/You name the rewards/i)).toBeInTheDocument();
    expect(screen.getByText(/how many points each should cost/i)).toBeVisible();
    expect(screen.getByText(/You pick one\s+and publish/i)).toBeVisible();
  });

  it("promises nothing goes live without the owner", () => {
    render(
      <LoyaltyConsultation organizationId={ORG} hasActiveProgram={false} />,
    );
    expect(
      screen.getByText(/Nothing changes until you press\s+publish/i),
    ).toBeVisible();
  });

  it("credits the arithmetic, not the model, for the numbers", () => {
    render(
      <LoyaltyConsultation organizationId={ORG} hasActiveProgram={false} />,
    );
    const note = screen.getByText(/numbers are calculated, not guessed/i);
    expect(note.closest("p")!.textContent).toMatch(
      /server-side arithmetic using only what you typed/i,
    );
  });

  it("names the model only where one is actually configured", () => {
    const { unmount } = render(
      <LoyaltyConsultation organizationId={ORG} hasActiveProgram={false} />,
    );
    // Claiming an AI that isn't wired up would be a lie to the vendor.
    expect(screen.queryByText(/Claude Opus/i)).not.toBeInTheDocument();
    expect(screen.getByText(/explanations are switched off/i)).toBeVisible();
    unmount();

    render(
      <LoyaltyConsultation
        organizationId={ORG}
        hasActiveProgram={false}
        aiEnabled
      />,
    );
    expect(screen.getByText(/with Claude Opus 4\.8/i)).toBeVisible();
    expect(
      screen.getByText(/cannot publish, change, or pay out/i),
    ).toBeInTheDocument();
  });

  it("shows no results until the owner asks for them", () => {
    render(
      <LoyaltyConsultation organizationId={ORG} hasActiveProgram={false} />,
    );
    expect(
      screen.queryByRole("heading", { name: /Recommended programs/i }),
    ).not.toBeInTheDocument();
  });

  it("rejects junk in a money field with a field-level explanation", async () => {
    const user = userEvent.setup();
    render(
      <LoyaltyConsultation organizationId={ORG} hasActiveProgram={false} />,
    );
    await user.type(screen.getByLabelText("Typical order total"), "idk");
    await user.type(screen.getByLabelText("Which item?"), "Horchata");
    await user.type(screen.getByLabelText("Menu price"), "3.50");
    await user.click(
      screen.getByRole("button", { name: /Get recommendations/i }),
    );

    expect(screen.getByText(/must be a number like/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Recommended programs/i }),
    ).not.toBeInTheDocument();
  });

  it("calculates recommendations from the current answers", async () => {
    const user = userEvent.setup();
    render(
      <LoyaltyConsultation organizationId={ORG} hasActiveProgram={false} />,
    );
    await fillValidForm(user);
    await user.click(
      screen.getByRole("button", { name: /Get recommendations/i }),
    );

    expect(getRecommendations()).toBeInTheDocument();
    // 10 pts/$ is the scale on every recommendation.
    expect(screen.getAllByText(/10 points per \$1/i).length).toBeGreaterThan(0);
  });

  it("shows a summary of the inputs the numbers came from", async () => {
    const user = userEvent.setup();
    render(
      <LoyaltyConsultation organizationId={ORG} hasActiveProgram={false} />,
    );
    await fillValidForm(user);
    await user.click(
      screen.getByRole("button", { name: /Get recommendations/i }),
    );

    const summary = screen
      .getByText(/What these numbers were calculated from/i)
      .closest("div")!.parentElement!;
    expect(
      within(summary).getByText(/Typical order total/),
    ).toBeInTheDocument();
    expect(
      within(summary).getByText(/Regular visits per week/),
    ).toBeInTheDocument();
    expect(within(summary).getAllByText(/your figure/).length).toBeGreaterThan(
      0,
    );
  });

  it("moves focus to the results so submitting never looks like a no-op", async () => {
    const user = userEvent.setup();
    render(
      <LoyaltyConsultation organizationId={ORG} hasActiveProgram={false} />,
    );
    await fillValidForm(user);
    await user.click(
      screen.getByRole("button", { name: /Get recommendations/i }),
    );

    await waitFor(() =>
      expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled(),
    );
  });

  /* -------------------------------------------------------------- */
  /* Staleness — the core Gate 1 guarantee                           */
  /* -------------------------------------------------------------- */

  describe("stale results", () => {
    async function computeThenChangeAnInput() {
      const user = userEvent.setup();
      render(
        <LoyaltyConsultation organizationId={ORG} hasActiveProgram={false} />,
      );
      await fillValidForm(user);
      await user.click(
        screen.getByRole("button", { name: /Get recommendations/i }),
      );
      expect(getRecommendations()).toBeInTheDocument();

      // Change a recommendation-driving answer AFTER calculating.
      await user.clear(screen.getByLabelText("Typical order total"));
      await user.type(screen.getByLabelText("Typical order total"), "11");
      return user;
    }

    it("marks existing results as out of date when an input changes", async () => {
      await computeThenChangeAnInput();
      expect(
        screen.getByText(/These results are out of date\./i),
      ).toBeInTheDocument();
      expect(screen.getByText(/no longer match the form/i)).toBeInTheDocument();
    });

    it("disables publishing while results are stale", async () => {
      await computeThenChangeAnInput();
      expect(
        screen.queryByRole("button", { name: /Approve & publish/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.getAllByText(/Recalculate before publishing this option/i)
          .length,
      ).toBeGreaterThan(0);
    });

    it("never calls the publish action from a stale card", async () => {
      await computeThenChangeAnInput();
      expect(publishLoyaltyProgramActionMock).not.toHaveBeenCalled();
    });

    it("relabels the button so recalculation is the obvious next step", async () => {
      await computeThenChangeAnInput();
      expect(
        screen.getByRole("button", { name: /Recalculate with these answers/i }),
      ).toBeInTheDocument();
    });

    it("clears staleness and recomputes from the new answers", async () => {
      const user = await computeThenChangeAnInput();
      await user.click(
        screen.getByRole("button", { name: /Recalculate with these answers/i }),
      );

      expect(
        screen.queryByText(/These results are out of date\./i),
      ).not.toBeInTheDocument();
      expect(
        screen.getAllByRole("button", { name: /Approve & publish/i }).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByRole("button", { name: /Approve & publish/i }).length,
      ).toBeGreaterThan(0);
    });

    it("treats reverting to the original answers as fresh again", async () => {
      const user = await computeThenChangeAnInput();
      expect(
        screen.getByText(/These results are out of date\./i),
      ).toBeInTheDocument();

      await user.clear(screen.getByLabelText("Typical order total"));
      await user.type(screen.getByLabelText("Typical order total"), "12");

      expect(
        screen.queryByText(/These results are out of date\./i),
      ).not.toBeInTheDocument();
    });

    it("goes stale when the reward type changes, not just numbers", async () => {
      const user = userEvent.setup();
      render(
        <LoyaltyConsultation organizationId={ORG} hasActiveProgram={false} />,
      );
      await fillValidForm(user);
      await user.click(
        screen.getByRole("button", { name: /Get recommendations/i }),
      );
      await user.selectOptions(screen.getByLabelText("Type"), "FIXED_DISCOUNT");
      expect(
        screen.getByText(/These results are out of date\./i),
      ).toBeInTheDocument();
    });
  });

  /* -------------------------------------------------------------- */
  /* Reward kinds                                                    */
  /* -------------------------------------------------------------- */

  it("hides the cost field for a discount and says the amount IS the cost", async () => {
    const user = userEvent.setup();
    render(
      <LoyaltyConsultation organizationId={ORG} hasActiveProgram={false} />,
    );
    await user.selectOptions(screen.getByLabelText("Type"), "FIXED_DISCOUNT");
    expect(
      screen.queryByLabelText("What it costs you to make"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText(/full face value/i).length).toBeGreaterThan(0);
  });

  it("asks for a discount amount rather than a menu price", async () => {
    const user = userEvent.setup();
    render(
      <LoyaltyConsultation organizationId={ORG} hasActiveProgram={false} />,
    );
    await user.selectOptions(screen.getByLabelText("Type"), "FIXED_DISCOUNT");
    expect(screen.getByLabelText("How much off?")).toBeInTheDocument();
    expect(screen.queryByLabelText("Menu price")).not.toBeInTheDocument();
  });

  it("asks a discount for one number, not a name that repeats it", async () => {
    const user = userEvent.setup();
    render(
      <LoyaltyConsultation organizationId={ORG} hasActiveProgram={false} />,
    );
    // A free item needs naming...
    expect(screen.getByLabelText("Which item?")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Type"), "FIXED_DISCOUNT");
    // ...but "$3 off" is the amount restated, so asking for both invited two
    // figures that could disagree, and the words were never used anyway.
    expect(screen.queryByLabelText("Which item?")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Label")).not.toBeInTheDocument();
  });

  it("names a discount from its amount when recommending", async () => {
    const user = userEvent.setup();
    render(
      <LoyaltyConsultation organizationId={ORG} hasActiveProgram={false} />,
    );
    await user.type(screen.getByLabelText("Typical order total"), "12");
    await user.selectOptions(screen.getByLabelText("Type"), "FIXED_DISCOUNT");
    await user.type(screen.getByLabelText("How much off?"), "3");
    await user.click(screen.getByRole("button", { name: /get recommend/i }));

    await waitFor(() =>
      expect(screen.getAllByText(/\$3\.00 off/).length).toBeGreaterThan(0),
    );
  });

  /* -------------------------------------------------------------- */
  /* Exclusions and existing-system guidance                         */
  /* -------------------------------------------------------------- */

  it("lists excluded options with reasons instead of dropping them", async () => {
    const user = userEvent.setup();
    render(
      <LoyaltyConsultation organizationId={ORG} hasActiveProgram={false} />,
    );
    await user.type(screen.getByLabelText("Typical order total"), "11");
    await user.type(screen.getByLabelText("Which item?"), "expensive plate");
    await user.type(screen.getByLabelText("Menu price"), "10");
    await user.selectOptions(costModeSelect(), "known");
    await user.type(screen.getByLabelText("What it costs you to make"), "6");
    await user.click(
      screen.getByRole("button", { name: /Get recommendations/i }),
    );

    expect(
      screen.getByText(/Why some options were excluded/i),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/Blocked by platform limit/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/What would fix it/i).length).toBeGreaterThan(0);
  });

  it("shows a titled migration plan for paper punch cards", async () => {
    const user = userEvent.setup();
    render(
      <LoyaltyConsultation organizationId={ORG} hasActiveProgram={false} />,
    );
    await fillValidForm(user);
    await user.selectOptions(
      screen.getByLabelText(/Do you already run a loyalty program/i),
      "paper",
    );
    await user.click(
      screen.getByRole("button", { name: /Get recommendations/i }),
    );

    expect(
      screen.getByText(/Moving from paper punch cards/i),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("list").length).toBeGreaterThan(0);
  });

  it("shows no existing-system section when there is no current program", async () => {
    const user = userEvent.setup();
    render(
      <LoyaltyConsultation organizationId={ORG} hasActiveProgram={false} />,
    );
    await fillValidForm(user);
    await user.click(
      screen.getByRole("button", { name: /Get recommendations/i }),
    );

    expect(
      screen.queryByText(/Moving from paper punch cards/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Using CurbAgora with your/i),
    ).not.toBeInTheDocument();
  });
});
