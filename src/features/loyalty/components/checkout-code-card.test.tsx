import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CheckoutCodeCard } from "@/features/loyalty/components/checkout-code-card";
import {
  cancelCheckoutSessionAction,
  getCheckoutStatusAction,
  startCheckoutSessionAction,
} from "@/features/loyalty/actions";
import { CHECKOUT_PAYLOAD_PREFIX } from "@/features/loyalty/checkout-code";

vi.mock("@/features/loyalty/actions", () => ({
  startCheckoutSessionAction: vi.fn(),
  cancelCheckoutSessionAction: vi.fn(),
  getCheckoutStatusAction: vi.fn(),
}));

const startMock = vi.mocked(startCheckoutSessionAction);
const cancelMock = vi.mocked(cancelCheckoutSessionAction);
const statusMock = vi.mocked(getCheckoutStatusAction);

const VENDOR = {
  organizationId: "org-1",
  organizationName: "Rosa Tacos",
  vendorUnitId: "unit-1",
  pointsPerDollar: 10,
  nextRewardLabel: "Free drink",
  // 500 against the post-award balance of 410 reproduces the documented
  // example: "90 points until your next reward — about $9 more".
  nextRewardPointsCost: 500,
};

const TOKEN = "a".repeat(43);

function session(overrides: Partial<{ expiresAt: string }> = {}) {
  return {
    ok: true as const,
    session: {
      sessionId: "session-1",
      qrPayload: `${CHECKOUT_PAYLOAD_PREFIX}${TOKEN}`,
      numericCode: "4827",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  statusMock.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("opening a checkout code", () => {
  it("mints nothing until the customer asks", () => {
    render(<CheckoutCodeCard vendor={VENDOR} />);
    expect(startMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /show my checkout code/i }),
    ).toBeVisible();
  });

  it("shows the QR and the four digits together", async () => {
    const user = userEvent.setup();
    startMock.mockResolvedValue(session());
    render(<CheckoutCodeCard vendor={VENDOR} />);
    await user.click(
      screen.getByRole("button", { name: /show my checkout code/i }),
    );

    await waitFor(() => expect(screen.getByText("4827")).toBeVisible());
    expect(
      screen.getByRole("img", { name: /checkout code for rosa tacos/i }),
    ).toBeVisible();
    expect(startMock).toHaveBeenCalledWith("org-1", "unit-1");
  });

  it("tells the customer whose code this is and what to do with it", async () => {
    const user = userEvent.setup();
    startMock.mockResolvedValue(session());
    render(<CheckoutCodeCard vendor={VENDOR} />);
    await user.click(
      screen.getByRole("button", { name: /show my checkout code/i }),
    );

    // Ownership first: the screen must not read as a vendor tool.
    await waitFor(() => expect(screen.getByText(/^Your code$/i)).toBeVisible());
    expect(screen.getByText(/Hold this up at Rosa Tacos/i)).toBeVisible();
    // Who to show it to, in words that don't assume a staffed counter.
    expect(
      screen.getByText(/person taking your payment, before you pay/i),
    ).toBeVisible();
  });

  it("puts no customer information in the QR payload", async () => {
    const user = userEvent.setup();
    startMock.mockResolvedValue(session());
    render(<CheckoutCodeCard vendor={VENDOR} />);
    await user.click(
      screen.getByRole("button", { name: /show my checkout code/i }),
    );
    await waitFor(() => expect(screen.getByText("4827")).toBeVisible());

    const payload = startMock.mock.results[0];
    expect(payload).toBeTruthy();
    // The payload is scheme + opaque token only.
    expect(session().session.qrPayload).toBe(
      `${CHECKOUT_PAYLOAD_PREFIX}${TOKEN}`,
    );
    expect(session().session.qrPayload).not.toContain("org-1");
    expect(session().session.qrPayload).not.toContain("session-1");
  });

  it("surfaces a paused program instead of a blank code", async () => {
    const user = userEvent.setup();
    startMock.mockResolvedValue({
      ok: false,
      message: "this vendor is not currently awarding points",
    });
    render(<CheckoutCodeCard vendor={VENDOR} />);
    await user.click(
      screen.getByRole("button", { name: /show my checkout code/i }),
    );
    await waitFor(() =>
      expect(screen.getByText(/not currently awarding points/i)).toBeVisible(),
    );
  });
});

describe("countdown and refresh", () => {
  it("counts down toward expiry", async () => {
    const user = userEvent.setup();
    startMock.mockResolvedValue(
      session({ expiresAt: new Date(Date.now() + 272_000).toISOString() }),
    );
    render(<CheckoutCodeCard vendor={VENDOR} />);
    await user.click(
      screen.getByRole("button", { name: /show my checkout code/i }),
    );
    await waitFor(() =>
      expect(screen.getByText(/Expires in 4:3\d/)).toBeVisible(),
    );
  });

  it("retires the old session when refreshing", async () => {
    const user = userEvent.setup();
    startMock.mockResolvedValue(session());
    cancelMock.mockResolvedValue(undefined);
    render(<CheckoutCodeCard vendor={VENDOR} />);
    await user.click(
      screen.getByRole("button", { name: /show my checkout code/i }),
    );
    await waitFor(() => expect(screen.getByText("4827")).toBeVisible());

    startMock.mockResolvedValue({
      ok: true,
      session: {
        ...session().session,
        sessionId: "session-2",
        numericCode: "1593",
      },
    });
    await user.click(screen.getByRole("button", { name: /refresh code/i }));

    await waitFor(() => expect(screen.getByText("1593")).toBeVisible());
    expect(cancelMock).toHaveBeenCalledWith("session-1");
    expect(screen.queryByText("4827")).not.toBeInTheDocument();
  });

  it("stops showing an expired code and offers a fresh one", async () => {
    const user = userEvent.setup();
    startMock.mockResolvedValue(
      session({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
    );
    render(<CheckoutCodeCard vendor={VENDOR} />);
    await user.click(
      screen.getByRole("button", { name: /show my checkout code/i }),
    );

    await waitFor(() =>
      expect(screen.getByText(/that code expired/i)).toBeVisible(),
    );
    expect(screen.queryByText("4827")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /show my checkout code/i }),
    ).toBeVisible();
  });
});

describe("confirmation", () => {
  it("announces the award without the customer refreshing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });
    startMock.mockResolvedValue(session());
    render(<CheckoutCodeCard vendor={VENDOR} />);
    await user.click(
      screen.getByRole("button", { name: /show my checkout code/i }),
    );
    await waitFor(() => expect(screen.getByText("4827")).toBeVisible());

    statusMock.mockResolvedValue({
      status: "confirmed",
      pointsAwarded: 234,
      pointBalance: 410,
      expiresAt: session().session.expiresAt,
    });
    await vi.advanceTimersByTimeAsync(3100);

    await waitFor(() =>
      expect(screen.getByText(/234 pts earned/i)).toBeVisible(),
    );
    expect(screen.getByText(/New balance: 410 pts/i)).toBeVisible();
    // The remaining gap and the spend it implies, both from the server balance.
    expect(screen.getByText(/90 pts until Free drink/i)).toBeVisible();
    expect(screen.getByText(/\$9\.00 more/)).toBeVisible();
  });

  it("stops polling once the award has landed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });
    startMock.mockResolvedValue(session());
    render(<CheckoutCodeCard vendor={VENDOR} />);
    await user.click(
      screen.getByRole("button", { name: /show my checkout code/i }),
    );
    await waitFor(() => expect(screen.getByText("4827")).toBeVisible());

    statusMock.mockResolvedValue({
      status: "confirmed",
      pointsAwarded: 234,
      pointBalance: 410,
      expiresAt: session().session.expiresAt,
    });
    await vi.advanceTimersByTimeAsync(3100);
    await waitFor(() =>
      expect(screen.getByText(/234 pts earned/i)).toBeVisible(),
    );

    const callsAtAward = statusMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(12_000);
    expect(statusMock.mock.calls.length).toBe(callsAtAward);
  });

  it("does not re-show a consumed code after Done", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });
    startMock.mockResolvedValue(session());
    render(<CheckoutCodeCard vendor={VENDOR} />);
    await user.click(
      screen.getByRole("button", { name: /show my checkout code/i }),
    );
    await waitFor(() => expect(screen.getByText("4827")).toBeVisible());

    statusMock.mockResolvedValue({
      status: "confirmed",
      pointsAwarded: 234,
      pointBalance: 410,
      expiresAt: session().session.expiresAt,
    });
    await vi.advanceTimersByTimeAsync(3100);
    await waitFor(() =>
      expect(screen.getByText(/234 pts earned/i)).toBeVisible(),
    );

    await user.click(screen.getByRole("button", { name: /^done$/i }));
    // Back to the start — the used code is gone, not re-displayed.
    expect(screen.queryByText("4827")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /show my checkout code/i }),
    ).toBeVisible();
  });
});
