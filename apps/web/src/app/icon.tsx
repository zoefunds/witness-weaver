import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// The WitnessWeave mark: a woven "W" ledger glyph — two interlocking
// checkmark-like strokes (witness accounts converging into one verified
// line) inside a rounded indigo tile, echoing the "living truth layer" idea
// without literally drawing scales-of-justice iconography.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#4f46e5",
          borderRadius: 7,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path
            d="M3 6 L8 18 L12 9 L16 18 L21 6"
            stroke="#dad7ff"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <circle cx="12" cy="9" r="1.6" fill="#4edea3" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
