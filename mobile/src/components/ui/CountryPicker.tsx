import { useMemo } from 'react';

import { COUNTRIES, countryLabel } from '../../lib/countries';
import { Select } from './Select';

export interface CountryPickerProps {
  /** Dial code, e.g. "+91". */
  value: string;
  onChange: (dial: string) => void;
  error?: string | null;
  disabled?: boolean;
  testID?: string;
}

/** The home country for telling local callers from international ones.
 *  Shows "India (+91)" so nobody mistakes it for a phone number field. */
export function CountryPicker({ value, onChange, error, disabled, testID }: CountryPickerProps) {
  const options = useMemo(
    () =>
      COUNTRIES.map((c) => ({
        value: `${c.dial}|${c.iso}`,
        label: c.name,
        description: c.dial,
        keywords: `${c.dial} ${c.dial.slice(1)} ${c.iso}`,
      })),
    [],
  );
  const selected = options.find((o) => o.value.startsWith(`${value}|`))?.value ?? null;
  return (
    <Select
      testID={testID}
      label="Your country"
      sheetTitle="Choose your country"
      value={selected}
      display={countryLabel(value)}
      options={options}
      searchable
      onChange={(v) => onChange(v.split('|')[0])}
      helper="Not your phone number. It tells local callers from international ones."
      error={error}
      disabled={disabled}
    />
  );
}
