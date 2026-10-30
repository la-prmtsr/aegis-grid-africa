// Phone country codes for sign up / log in / MoMo. Ghana first (the pilot), then Africa A–Z, then other countries
// where the team and judges are. len: allowed digits of the national number (after the country code, without the
// leading 0). Validation is a sanity check for the prototype, not full numbering-plan validation.
export const COUNTRIES = [
  { iso: 'GH', name: 'Ghana', dial: '233', len: [9, 9], eg: '24 123 4567' },
  // Africa
  { iso: 'DZ', name: 'Algeria', dial: '213', len: [9, 9], eg: '551 23 45 67' },
  { iso: 'AO', name: 'Angola', dial: '244', len: [9, 9], eg: '923 123 456' },
  { iso: 'BJ', name: 'Benin', dial: '229', len: [8, 10], eg: '01 90 01 12 34' },
  { iso: 'BW', name: 'Botswana', dial: '267', len: [7, 8], eg: '71 123 456' },
  { iso: 'BF', name: 'Burkina Faso', dial: '226', len: [8, 8], eg: '70 12 34 56' },
  { iso: 'CM', name: 'Cameroon', dial: '237', len: [9, 9], eg: '6 71 23 45 67' },
  { iso: 'CI', name: "Côte d'Ivoire", dial: '225', len: [10, 10], eg: '01 23 45 67 89' },
  { iso: 'CD', name: 'DR Congo', dial: '243', len: [9, 9], eg: '991 234 567' },
  { iso: 'EG', name: 'Egypt', dial: '20', len: [10, 10], eg: '100 123 4567' },
  { iso: 'ET', name: 'Ethiopia', dial: '251', len: [9, 9], eg: '91 123 4567' },
  { iso: 'GM', name: 'Gambia', dial: '220', len: [7, 7], eg: '301 2345' },
  { iso: 'GN', name: 'Guinea', dial: '224', len: [9, 9], eg: '601 12 34 56' },
  { iso: 'KE', name: 'Kenya', dial: '254', len: [9, 9], eg: '712 345 678' },
  { iso: 'LR', name: 'Liberia', dial: '231', len: [7, 9], eg: '77 012 3456' },
  { iso: 'MW', name: 'Malawi', dial: '265', len: [9, 9], eg: '991 23 45 67' },
  { iso: 'ML', name: 'Mali', dial: '223', len: [8, 8], eg: '65 01 23 45' },
  { iso: 'MA', name: 'Morocco', dial: '212', len: [9, 9], eg: '650 123 456' },
  { iso: 'MZ', name: 'Mozambique', dial: '258', len: [9, 9], eg: '82 123 4567' },
  { iso: 'NA', name: 'Namibia', dial: '264', len: [8, 9], eg: '81 123 4567' },
  { iso: 'NE', name: 'Niger', dial: '227', len: [8, 8], eg: '93 12 34 56' },
  { iso: 'NG', name: 'Nigeria', dial: '234', len: [10, 10], eg: '802 123 4567' },
  { iso: 'RW', name: 'Rwanda', dial: '250', len: [9, 9], eg: '720 123 456' },
  { iso: 'SN', name: 'Senegal', dial: '221', len: [9, 9], eg: '70 123 45 67' },
  { iso: 'SL', name: 'Sierra Leone', dial: '232', len: [8, 8], eg: '25 123456' },
  { iso: 'ZA', name: 'South Africa', dial: '27', len: [9, 9], eg: '71 123 4567' },
  { iso: 'TZ', name: 'Tanzania', dial: '255', len: [9, 9], eg: '621 234 567' },
  { iso: 'TG', name: 'Togo', dial: '228', len: [8, 8], eg: '90 11 23 45' },
  { iso: 'TN', name: 'Tunisia', dial: '216', len: [8, 8], eg: '20 123 456' },
  { iso: 'UG', name: 'Uganda', dial: '256', len: [9, 9], eg: '712 345678' },
  { iso: 'ZM', name: 'Zambia', dial: '260', len: [9, 9], eg: '95 5123456' },
  { iso: 'ZW', name: 'Zimbabwe', dial: '263', len: [9, 9], eg: '71 212 3456' },
  // elsewhere
  { iso: 'AU', name: 'Australia', dial: '61', len: [9, 9], eg: '412 345 678' },
  { iso: 'BR', name: 'Brazil', dial: '55', len: [10, 11], eg: '11 96123 4567' },
  { iso: 'CA', name: 'Canada', dial: '1', len: [10, 10], eg: '506 234 5678' },
  { iso: 'CN', name: 'China', dial: '86', len: [11, 11], eg: '131 2345 6789' },
  { iso: 'FR', name: 'France', dial: '33', len: [9, 9], eg: '6 12 34 56 78' },
  { iso: 'DE', name: 'Germany', dial: '49', len: [10, 11], eg: '1512 3456789' },
  { iso: 'IN', name: 'India', dial: '91', len: [10, 10], eg: '81234 56789' },
  { iso: 'ID', name: 'Indonesia', dial: '62', len: [9, 12], eg: '812 3456 7890' },
  { iso: 'JP', name: 'Japan', dial: '81', len: [10, 10], eg: '90 1234 5678' },
  { iso: 'MY', name: 'Malaysia', dial: '60', len: [9, 10], eg: '12 345 6789' },
  { iso: 'NL', name: 'Netherlands', dial: '31', len: [9, 9], eg: '6 12345678' },
  { iso: 'SA', name: 'Saudi Arabia', dial: '966', len: [9, 9], eg: '51 234 5678' },
  { iso: 'SG', name: 'Singapore', dial: '65', len: [8, 8], eg: '8123 4567' },
  { iso: 'TR', name: 'Türkiye', dial: '90', len: [10, 10], eg: '501 234 56 78' },
  { iso: 'AE', name: 'United Arab Emirates', dial: '971', len: [9, 9], eg: '50 123 4567' },
  { iso: 'GB', name: 'United Kingdom', dial: '44', len: [10, 10], eg: '7400 123456' },
  { iso: 'US', name: 'United States', dial: '1', len: [10, 10], eg: '201 555 0123' },
];

export const DEFAULT_COUNTRY = 'GH';
export const countryByIso = (iso) => COUNTRIES.find((c) => c.iso === iso) || COUNTRIES[0];

/** Country of a stored +E.164 number: the longest matching dial code (for +1, United States). */
export function countryOf(e164) {
  const d = String(e164 || '').replace(/^\+/, '');
  let best = null;
  for (const c of COUNTRIES) {
    if (d.startsWith(c.dial) && (!best || c.dial.length > best.dial.length || (c.dial === best.dial && c.iso === 'US'))) best = c;
  }
  return best;
}
