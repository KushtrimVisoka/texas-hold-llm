import type { Suit } from './cards';

/**
 * Suit pips as SVG paths on a 24x24 box.
 *
 * Drawn rather than typed: the bundled Inter subset has no glyphs for the suit
 * characters, so the renderer would emit tofu boxes onto the agent's screenshot.
 */
export const SUIT_PATH: Record<Suit, string> = {
  s: 'M12 2.2c-1.6 2.5-8 6.7-8 11.1a4.3 4.3 0 0 0 7 3.4l-1.1 5.1h4.2L13 16.7a4.3 4.3 0 0 0 7-3.4c0-4.4-6.4-8.6-8-11.1z',
  h: 'M12 21.3S3.6 15.6 3.6 9.9a4.6 4.6 0 0 1 8.4-2.6 4.6 4.6 0 0 1 8.4 2.6c0 5.7-8.4 11.4-8.4 11.4z',
  d: 'M12 1.8 20 12l-8 10.2L4 12z',
  c: 'M12 2a4.1 4.1 0 0 0-3.2 6.7 4.1 4.1 0 1 0-.6 7.9c1 0 1.9-.3 2.6-.9L9.9 21.8h4.2L13.2 15.7c.7.6 1.6.9 2.6.9a4.1 4.1 0 1 0-.6-7.9A4.1 4.1 0 0 0 12 2z',
};
