import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StaffCheckout } from "@/features/loyalty/components/staff-checkout";
import {
  awardPointsAction,
  resolveCheckoutSessionAction,
} from "@/features/loyalty/actions";

vi.mock("@/features/loyalty/actions", () => ({
  resolveCheckoutSessionAction: vi.fn(),
  awardPointsAction: vi.fn(),
}));

const resolveMock = vi.mocked(resolveCheckoutSessionAction);
const awardMock = vi.mocked(awardPointsAction);

const MEMBER = {
  sessionId: "session-1",
  displayName: "Rosa",
  memberRef: "•4821",
  pointBalance: 176,
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
};

/** Track every stream handed out so tests can assert the tracks were stopped. */
const streams: { stop: ReturnType<typeof vi.fn> }[] = [];

function mockCamera(behavior: "grant" | "deny" = "grant") {
  const stop = vi.fn();
  streams.push({ stop });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        if (behavior === "deny") {
          const error = new Error("denied");
          error.name = "NotAllowedError";
          throw error;
        }
        return { getTracks: () => [{ stop }] } as unknown as MediaStream;
      }),
    },
  });
  return stop;
}

beforeEach(() => {
  vi.clearAllMocks();
  streams.length = 0;
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  // A browser without BarcodeDetector is the interesting case (iOS Safari).
  delete (window as unknown as Record<string, unknown>).BarcodeDetector;
  window.HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
});

describe("identification screen", () => {
  it("offers both methods with equal prominence", () => {
    render(<StaffCheckout pointsPerDollar={10} />);
    expect(
      screen.getByRole("button", { name: /scan customer qr/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /enter 4-digit code/i }),
    ).toBeInTheDocument();
  });

  it("never asks for the camera on load", () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    render(<StaffCheckout pointsPerDollar={10} />);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("shows no customer list to search", () => {
    render(<StaffCheckout pointsPerDollar={10} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/name/i)).not.toBeInTheDocument();
  });
});

describe("camera permission", () => {
  it("asks only after an explicit tap, and explains why first", async () => {
    const user = userEvent.setup();
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    render(<StaffCheckout pointsPerDollar={10} />);

    await user.click(screen.getByRole("button", { name: /scan customer qr/i }));
    expect(screen.getByText(/images and video are not saved/i)).toBeVisible();
    expect(getUserMedia).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: /allow camera and scan/i }),
    );
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("prefers the rear camera", async () => {
    const user = userEvent.setup();
    mockCamera();
    render(<StaffCheckout pointsPerDollar={10} />);
    await user.click(screen.getByRole("button", { name: /scan customer qr/i }));
    await user.click(
      screen.getByRole("button", { name: /allow camera and scan/i }),
    );
    await waitFor(() =>
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          video: { facingMode: { ideal: "environment" } },
        }),
      ),
    );
  });

  it("stops every track when staff cancels", async () => {
    const user = userEvent.setup();
    const stop = mockCamera();
    render(<StaffCheckout pointsPerDollar={10} />);
    await user.click(screen.getByRole("button", { name: /scan customer qr/i }));
    await user.click(
      screen.getByRole("button", { name: /allow camera and scan/i }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^cancel$/i })).toBeVisible(),
    );
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(stop).toHaveBeenCalled();
  });

  it("stops every track on unmount", async () => {
    const user = userEvent.setup();
    const stop = mockCamera();
    const view = render(<StaffCheckout pointsPerDollar={10} />);
    await user.click(screen.getByRole("button", { name: /scan customer qr/i }));
    await user.click(
      screen.getByRole("button", { name: /allow camera and scan/i }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^cancel$/i })).toBeVisible(),
    );
    view.unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("falls back to code entry when permission is denied", async () => {
    const user = userEvent.setup();
    mockCamera("deny");
    render(<StaffCheckout pointsPerDollar={10} />);
    await user.click(screen.getByRole("button", { name: /scan customer qr/i }));
    await user.click(
      screen.getByRole("button", { name: /allow camera and scan/i }),
    );
    await waitFor(() =>
      expect(screen.getByText(/camera access was denied/i)).toBeVisible(),
    );
    // The manual path is right there, not behind a back-navigation.
    expect(
      screen.getByRole("button", { name: /enter 4-digit code instead/i }),
    ).toBeVisible();
  });

  it("falls back to code entry when the browser has no camera API", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {},
    });
    render(<StaffCheckout pointsPerDollar={10} />);
    await user.click(screen.getByRole("button", { name: /scan customer qr/i }));
    await user.click(
      screen.getByRole("button", { name: /allow camera and scan/i }),
    );
    await waitFor(() =>
      expect(screen.getByText(/can't use the camera/i)).toBeVisible(),
    );
    expect(
      screen.getByRole("button", { name: /enter 4-digit code instead/i }),
    ).toBeVisible();
  });

  it("refuses to start on an insecure origin", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: false,
    });
    mockCamera();
    render(<StaffCheckout pointsPerDollar={10} />);
    await user.click(screen.getByRole("button", { name: /scan customer qr/i }));
    await user.click(
      screen.getByRole("button", { name: /allow camera and scan/i }),
    );
    await waitFor(() =>
      expect(screen.getByText(/secure \(https\) connection/i)).toBeVisible(),
    );
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });
});

describe("4-digit code path", () => {
  it("uses a numeric keypad and accepts only four digits", async () => {
    const user = userEvent.setup();
    render(<StaffCheckout pointsPerDollar={10} />);
    await user.click(
      screen.getByRole("button", { name: /enter 4-digit code/i }),
    );
    const input = screen.getByLabelText(/enter 4-digit code/i);
    expect(input).toHaveAttribute("inputMode", "numeric");
    await user.type(input, "48a2799");
    expect(input).toHaveValue("4827");
  });

  it("keeps the submit disabled until four digits are present", async () => {
    const user = userEvent.setup();
    render(<StaffCheckout pointsPerDollar={10} />);
    await user.click(
      screen.getByRole("button", { name: /enter 4-digit code/i }),
    );
    const submit = screen.getByRole("button", { name: /find customer/i });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/enter 4-digit code/i), "482");
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/enter 4-digit code/i), "7");
    expect(submit).toBeEnabled();
  });

  it("advances to the subtotal step on a valid code", async () => {
    const user = userEvent.setup();
    resolveMock.mockResolvedValue({ ok: true, member: MEMBER });
    render(<StaffCheckout pointsPerDollar={10} />);
    await user.click(
      screen.getByRole("button", { name: /enter 4-digit code/i }),
    );
    await user.type(screen.getByLabelText(/enter 4-digit code/i), "4827");
    await user.click(screen.getByRole("button", { name: /find customer/i }));

    await waitFor(() =>
      expect(screen.getByText(/customer identified/i)).toBeVisible(),
    );
    expect(resolveMock).toHaveBeenCalledWith("code4", "4827");
    expect(screen.getByLabelText(/enter eligible subtotal/i)).toBeVisible();
  });

  it("shows a controlled error for an expired code and stays put", async () => {
    const user = userEvent.setup();
    resolveMock.mockResolvedValue({
      ok: false,
      message: "that code has expired — ask the customer to refresh it",
    });
    render(<StaffCheckout pointsPerDollar={10} />);
    await user.click(
      screen.getByRole("button", { name: /enter 4-digit code/i }),
    );
    await user.type(screen.getByLabelText(/enter 4-digit code/i), "4827");
    await user.click(screen.getByRole("button", { name: /find customer/i }));

    await waitFor(() => expect(screen.getByText(/has expired/i)).toBeVisible());
    // Correcting a mistyped digit must not require starting over.
    expect(screen.getByLabelText(/enter 4-digit code/i)).toBeVisible();
    expect(screen.queryByText(/customer identified/i)).not.toBeInTheDocument();
  });
});

describe("subtotal and award", () => {
  async function reachSubtotal(user: ReturnType<typeof userEvent.setup>) {
    resolveMock.mockResolvedValue({ ok: true, member: MEMBER });
    render(<StaffCheckout pointsPerDollar={10} />);
    await user.click(
      screen.getByRole("button", { name: /enter 4-digit code/i }),
    );
    await user.type(screen.getByLabelText(/enter 4-digit code/i), "4827");
    await user.click(screen.getByRole("button", { name: /find customer/i }));
    await waitFor(() =>
      expect(screen.getByLabelText(/enter eligible subtotal/i)).toBeVisible(),
    );
  }

  it("shows only safe identity details", async () => {
    await reachSubtotal(userEvent.setup());
    expect(screen.getByText("Rosa")).toBeVisible();
    expect(screen.getByText(/Member •4821/)).toBeVisible();
    // No contact details, no full identifier.
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
    expect(screen.queryByText(MEMBER.sessionId)).not.toBeInTheDocument();
  });

  it("explains what counts as eligible", async () => {
    await reachSubtotal(userEvent.setup());
    expect(screen.getByText(/before tax, tip, and fees/i)).toBeVisible();
  });

  it("previews the points the server will award", async () => {
    const user = userEvent.setup();
    await reachSubtotal(user);
    await user.type(screen.getByLabelText(/enter eligible subtotal/i), "23.40");
    expect(screen.getByText(/\$23\.40 → 234 pts/)).toBeVisible();
  });

  it("blocks the award until a usable amount is entered", async () => {
    const user = userEvent.setup();
    await reachSubtotal(user);
    const award = screen.getByRole("button", { name: /award points/i });
    expect(award).toBeDisabled();
    await user.type(screen.getByLabelText(/enter eligible subtotal/i), "abc");
    expect(award).toBeDisabled();
    await user.clear(screen.getByLabelText(/enter eligible subtotal/i));
    await user.type(screen.getByLabelText(/enter eligible subtotal/i), "23.40");
    expect(award).toBeEnabled();
  });

  it("returns to Next customer after a successful award", async () => {
    const user = userEvent.setup();
    awardMock.mockResolvedValue({
      ok: true,
      pointsAwarded: 234,
      pointBalance: 410,
      message: "ok",
    });
    await reachSubtotal(user);
    await user.type(screen.getByLabelText(/enter eligible subtotal/i), "23.40");
    await user.click(screen.getByRole("button", { name: /award points/i }));

    await waitFor(() =>
      expect(screen.getByText(/234 pts awarded/i)).toBeVisible(),
    );
    expect(awardMock).toHaveBeenCalledWith("session-1", "23.40");
    await user.click(screen.getByRole("button", { name: /next customer/i }));
    expect(
      screen.getByRole("button", { name: /scan customer qr/i }),
    ).toBeVisible();
  });

  it("surfaces a reused session without advancing", async () => {
    const user = userEvent.setup();
    awardMock.mockResolvedValue({
      ok: false,
      message: "that code was already used — ask the customer for a fresh one",
    });
    await reachSubtotal(user);
    await user.type(screen.getByLabelText(/enter eligible subtotal/i), "23.40");
    await user.click(screen.getByRole("button", { name: /award points/i }));

    await waitFor(() =>
      expect(screen.getByText(/already used/i)).toBeVisible(),
    );
    expect(screen.queryByText(/awarded/i)).not.toBeInTheDocument();
  });
});
