import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const enrollMfaActionMock = vi.fn();
const verifyMfaEnrollmentActionMock = vi.fn();

vi.mock("@/features/authentication/actions", () => ({
  enrollMfaAction: (...args: unknown[]) => enrollMfaActionMock(...args),
  verifyMfaEnrollmentAction: (...args: unknown[]) =>
    verifyMfaEnrollmentActionMock(...args),
}));

import { MfaEnrollment } from "@/features/authentication/components/mfa-enrollment";

const SECRET = "SECRETXYZ";

const URI = "otpauth://totp/CurbAgora:mock?secret=SECRETXYZ&issuer=CurbAgora";

function successfulEnrollment() {
  return {
    status: "success" as const,
    factorId: "factor-1",
    qrCode: "data:image/svg+xml;base64,mock",
    secret: SECRET,
    uri: URI,
  };
}

async function renderEnrolled() {
  enrollMfaActionMock.mockResolvedValueOnce(successfulEnrollment());
  verifyMfaEnrollmentActionMock.mockResolvedValue({ status: "idle" });
  const user = userEvent.setup();
  render(<MfaEnrollment nextPath="/onboarding/vendor" />);
  await user.click(
    screen.getByRole("button", { name: /set up authenticator app/i }),
  );
  await screen.findByAltText(/qr code/i);
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyMfaEnrollmentActionMock.mockResolvedValue({ status: "idle" });
});

/**
 * @testing-library/user-event's `setup()` installs its own clipboard stub on
 * `navigator.clipboard`, overwriting any mock defined beforehand — so this
 * must run after every `userEvent.setup()` call in a test, immediately
 * before the interaction that triggers a clipboard write.
 */
function stubClipboardWriteText() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

describe("MfaEnrollment — setup key disclosure", () => {
  it("hides the secret by default and reveals it on toggle", async () => {
    await renderEnrolled();

    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", {
      name: /can't scan\? show setup key/i,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    const user = userEvent.setup();
    await user.click(toggle);

    expect(screen.getByText(SECRET)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /hide setup key/i }),
    ).toHaveAttribute("aria-expanded", "true");
  });
});

describe("MfaEnrollment — copy to clipboard", () => {
  it("only renders Copy once the secret is revealed", async () => {
    await renderEnrolled();

    expect(
      screen.queryByRole("button", { name: /^copy$/i }),
    ).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /can't scan\? show setup key/i }),
    );

    expect(screen.getByRole("button", { name: /^copy$/i })).toBeInTheDocument();
  });

  it("copies the exact secret and shows transient confirmation", async () => {
    const user = await renderEnrolled();
    await user.click(
      screen.getByRole("button", { name: /can't scan\? show setup key/i }),
    );

    const writeText = stubClipboardWriteText();
    await user.click(screen.getByRole("button", { name: /^copy$/i }));

    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(
      await screen.findByRole("button", { name: /^copied$/i }),
    ).toBeInTheDocument();
  });
});

describe("MfaEnrollment — copy strings", () => {
  it("always shows the Security-settings recovery line and drops the old backup-secret advice", async () => {
    await renderEnrolled();

    expect(
      screen.getByText(
        /account recovery options are managed from security settings/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/store the manual key somewhere safe as a backup/i),
    ).not.toBeInTheDocument();
  });
});

describe("MfaEnrollment — mobile-first authenticator link", () => {
  it("renders an 'Open my authenticator app' link using the enrollment URI, alongside the QR code", async () => {
    await renderEnrolled();

    expect(
      screen.getByRole("link", { name: /open my authenticator app/i }),
    ).toHaveAttribute("href", URI);
    expect(screen.getByAltText(/qr code/i)).toBeInTheDocument();
  });

  it("does not ask the user to type a title or account name", async () => {
    await renderEnrolled();

    expect(
      screen.queryByLabelText(/title|username|account name/i),
    ).not.toBeInTheDocument();
  });
});

describe("MfaEnrollment — verification", () => {
  it("submits the 6-digit code with the factorId and next path", async () => {
    const user = await renderEnrolled();

    await user.type(screen.getByLabelText(/6-digit code/i), "123456");
    await user.click(
      screen.getByRole("button", { name: /confirm and enable/i }),
    );

    expect(verifyMfaEnrollmentActionMock).toHaveBeenCalledTimes(1);
    const [, formData] = verifyMfaEnrollmentActionMock.mock.calls[0] as [
      unknown,
      FormData,
    ];
    expect(formData.get("code")).toBe("123456");
    expect(formData.get("factorId")).toBe("factor-1");
    expect(formData.get("next")).toBe("/onboarding/vendor");
  });
});

describe("MfaEnrollment — QR sizing", () => {
  it("renders the QR image at the smaller integrated size", async () => {
    await renderEnrolled();

    const qr = screen.getByAltText(/qr code/i);
    expect(qr).toHaveAttribute("width", "128");
    expect(qr).toHaveAttribute("height", "128");
  });
});
