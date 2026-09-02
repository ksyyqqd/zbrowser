import { describe, expect, it } from 'vitest';
import { matchesRememberedElement } from '../navigator';

describe('matchesRememberedElement', () => {
  it('matches on an exact xpath hit', () => {
    const hints = [{ xpath: '/html/body/button[2]', selector: '#other' }];

    expect(matchesRememberedElement(hints, '/html/body/button[2]', [])).toBe(true);
  });

  it('matches on any css selector variant of the node', () => {
    const hints = [{ selector: 'button.submit' }];

    expect(
      matchesRememberedElement(hints, '/html/body/button[1]', ['button.submit[data-x="1"]', 'button.submit']),
    ).toBe(true);
  });

  it('does not match a different element', () => {
    const hints = [{ xpath: '/html/body/button[2]', selector: '#save' }];

    expect(matchesRememberedElement(hints, '/html/body/button[9]', ['#cancel'])).toBe(false);
  });

  it('ignores empty locators instead of matching everything', () => {
    // A hint with a blank xpath must not match a node whose xpath is also blank —
    // otherwise every textless element would look "remembered" and bypass the gate.
    const hints = [{ xpath: '   ', selector: '' }];

    expect(matchesRememberedElement(hints, '', [undefined, null, '  '])).toBe(false);
  });

  it('returns false when the store has no hints for the site', () => {
    expect(matchesRememberedElement([], '/html/body/button[1]', ['#a'])).toBe(false);
  });

  it('tolerates surrounding whitespace on both sides', () => {
    const hints = [{ xpath: '  /html/body/button[3]  ' }];

    expect(matchesRememberedElement(hints, '/html/body/button[3]', [])).toBe(true);
  });
});
