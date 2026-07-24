import qrcode from "qrcode-generator";

/**
 * The one place `qrcode-generator` is touched. Components receive a plain SVG
 * path and a module count, which keeps them free of library types and lets the
 * QR inherit theme tokens (`currentColor`) instead of a baked-in black — the
 * library's own `createSvgTag` hardcodes colours and a full `<svg>` wrapper.
 *
 * Error correction level M (~15% recoverable) is the practical choice for a
 * code held up on a phone screen outdoors: enough tolerance for glare and a
 * smudged screen without inflating the module count so far that the code stops
 * scanning at arm's length.
 */

export type QrPath = {
  /** SVG path `d` covering every dark module, in module units. */
  d: string;
  /** Width/height of the code in modules, excluding the quiet zone. */
  moduleCount: number;
  /** Quiet zone, in modules, already included in `viewBox`. */
  margin: number;
  /** Ready-to-use `viewBox` string including the quiet zone. */
  viewBox: string;
};

const MARGIN = 2;

export function qrPath(text: string): QrPath {
  // Type 0 = pick the smallest version that fits the payload.
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const parts: string[] = [];

  // Emit one rect-as-path per run of dark modules on a row rather than per
  // module: for a ~40-module code that is a few hundred path commands instead
  // of a few thousand, which matters when this re-renders on every countdown
  // tick's parent update.
  for (let row = 0; row < moduleCount; row++) {
    let runStart = -1;
    for (let col = 0; col <= moduleCount; col++) {
      const dark = col < moduleCount && qr.isDark(row, col);
      if (dark && runStart === -1) {
        runStart = col;
      } else if (!dark && runStart !== -1) {
        parts.push(
          `M${runStart + MARGIN} ${row + MARGIN}h${col - runStart}v1h-${col - runStart}z`,
        );
        runStart = -1;
      }
    }
  }

  const size = moduleCount + MARGIN * 2;
  return {
    d: parts.join(""),
    moduleCount,
    margin: MARGIN,
    viewBox: `0 0 ${size} ${size}`,
  };
}
