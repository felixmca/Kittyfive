/**
 * Kitty's face: the site's home mark. A tuxedo cat (black head, white blaze
 * running up between yellow eyes, white muzzle) outlined in the page's light
 * ink so it reads on the dark glass buttons. The same drawing is the favicon
 * (src/app/icon.svg) and the Apple touch icon.
 */
export default function KittyFace({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      focusable="false"
    >
      <path
        d="M24 12C26.5 12 28 12.4 29.5 13L37 6.5C38.2 6 39 6.6 39 7.8L39.5 19C43 25 42.5 34 36.5 39C32.5 42.5 28.5 43.5 24 43.5C19.5 43.5 15.5 42.5 11.5 39C5.5 34 5 25 8.5 19L9 7.8C9 6.6 9.8 6 11 6.5L18.5 13C20 12.4 21.5 12 24 12Z"
        fill="#141414"
        stroke="#f4f1ea"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12.2 10.6L16.6 14.4L12.4 17.6Z" fill="#d98c96" opacity=".75" />
      <path d="M35.8 10.6L31.4 14.4L35.6 17.6Z" fill="#d98c96" opacity=".75" />
      <path
        d="M24 16.5C25.1 21.5 25.9 25 28.4 27.8C32 30.4 33.1 34 31.6 37C29.6 40.6 18.4 40.6 16.4 37C14.9 34 16 30.4 19.6 27.8C22.1 25 22.9 21.5 24 16.5Z"
        fill="#f4f1ea"
      />
      <ellipse cx="16.6" cy="24" rx="3.5" ry="3.1" fill="#f2cf4a" />
      <ellipse cx="31.4" cy="24" rx="3.5" ry="3.1" fill="#f2cf4a" />
      <ellipse cx="16.6" cy="24" rx="1" ry="2.5" fill="#141414" />
      <ellipse cx="31.4" cy="24" rx="1" ry="2.5" fill="#141414" />
      <circle cx="17.6" cy="22.9" r=".75" fill="#fff" />
      <circle cx="32.4" cy="22.9" r=".75" fill="#fff" />
      <path d="M22.3 30.3H25.7L24 32.4Z" fill="#e59aa5" />
      <path
        d="M24 32.4C23.6 34 22.2 34.6 21 34M24 32.4C24.4 34 25.8 34.6 27 34"
        stroke="#6b6b6b"
        strokeWidth=".9"
        strokeLinecap="round"
      />
      <path
        d="M15.5 32.2L4.5 30.4M15.6 34.2L5 35.6M32.5 32.2L43.5 30.4M32.4 34.2L43 35.6"
        stroke="#f4f1ea"
        strokeOpacity=".75"
        strokeWidth=".8"
        strokeLinecap="round"
      />
    </svg>
  );
}
