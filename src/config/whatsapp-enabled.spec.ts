import { isWhatsAppEnabled, parseWhatsAppEnabled } from './whatsapp-enabled';

describe('parseWhatsAppEnabled', () => {
  it('treats an absent flag as disabled', () => {
    expect(parseWhatsAppEnabled(undefined)).toBe(false);
    expect(parseWhatsAppEnabled(null)).toBe(false);
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('parses the string %j as %s', (value, expected) => {
    expect(parseWhatsAppEnabled(value)).toBe(expected);
  });

  it.each([
    [true, true],
    [false, false],
  ])('passes through the boolean %s', (value, expected) => {
    expect(parseWhatsAppEnabled(value)).toBe(expected);
  });

  it.each([['yes'], ['1'], ['0'], [''], ['TRUE'], ['False'], ['on'], [2]])(
    'rejects the ambiguous value %j',
    (value) => {
      expect(() => parseWhatsAppEnabled(value)).toThrow('WHATSAPP_ENABLED');
    },
  );
});

describe('isWhatsAppEnabled', () => {
  it('reads WHATSAPP_ENABLED from the provided environment bag', () => {
    expect(isWhatsAppEnabled({ WHATSAPP_ENABLED: 'true' })).toBe(true);
    expect(isWhatsAppEnabled({ WHATSAPP_ENABLED: 'false' })).toBe(false);
    expect(isWhatsAppEnabled({})).toBe(false);
  });

  it('rejects an ambiguous WHATSAPP_ENABLED value', () => {
    expect(() => isWhatsAppEnabled({ WHATSAPP_ENABLED: 'yes' })).toThrow('WHATSAPP_ENABLED');
  });

  it('falls back to process.env and defaults to disabled when unset', () => {
    const previous = process.env.WHATSAPP_ENABLED;
    delete process.env.WHATSAPP_ENABLED;
    try {
      expect(isWhatsAppEnabled()).toBe(false);
    } finally {
      if (previous !== undefined) {
        process.env.WHATSAPP_ENABLED = previous;
      }
    }
  });
});
