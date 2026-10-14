import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { Numeral } from '@/components/ui/numeral';
import { MacroChips } from '@/components/ui/macro-chips';
import { StatRows } from '@/components/ui/stat-rows';
import { trendDomain } from '@/components/ui/trend-chart';
import { Progress } from '@/components/ui/progress';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en-AU' },
  }),
}));

describe('shared metric components', () => {
  it('formats numbers in the requested locale without losing zero or missing data', () => {
    const { rerender } = render(
      <Numeral value={1234.5} locale="de-DE" unit="kg" subline="Trend weight" />
    );
    expect(screen.getByText('1.234,5')).toBeInTheDocument();
    expect(screen.getByText('kg')).toBeInTheDocument();
    expect(screen.getByText('Trend weight')).toBeInTheDocument();
    rerender(<Numeral value={0} />);
    expect(screen.getByText('0')).toBeInTheDocument();
    rerender(<Numeral value={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    rerender(<Numeral value={NaN} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('labels macro values independently of their color and includes zero kcal', () => {
    render(<MacroChips protein={12.5} carbs={0} fat={8} kcal={0} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText('nutrition.protein')).toBeInTheDocument();
    expect(screen.getByText('12.5 g')).toBeInTheDocument();
    expect(screen.getByText('0 g')).toBeInTheDocument();
    expect(screen.getByText('0 kcal')).toBeInTheDocument();
  });

  it('keeps row values and metadata readable and respects disabled footer actions', () => {
    const apply = jest.fn();
    render(
      <StatRows
        rows={[
          { id: 'weight', label: 'Trend', value: '72 kg', meta: 'This week' },
        ]}
        actions={[
          { id: 'apply', label: 'Apply', onClick: apply },
          { id: 'keep', label: 'Keep', onClick: apply, disabled: true },
        ]}
      />
    );
    expect(screen.getByRole('term')).toHaveTextContent('Trend');
    expect(screen.getByRole('definition')).toHaveTextContent('72 kgThis week');
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('exposes progress values to assistive technology', () => {
    render(<Progress value={42} aria-label="Daily target" />);
    expect(
      screen.getByRole('progressbar', { name: 'Daily target' })
    ).toHaveAttribute('aria-valuenow', '42');
  });
});

describe('trend chart domain', () => {
  it('keeps small changes visible and includes a target outside the measurements', () => {
    const [min, max] = trendDomain(
      [
        { label: 'Mon', value: 179 },
        { label: 'Tue', value: 182 },
      ],
      175
    );
    expect(min).toBeLessThan(175);
    expect(max).toBeGreaterThan(182);
    expect(max - min).toBeLessThan(12);
  });

  it('gives constant and empty series a usable range without treating gaps as zero', () => {
    expect(trendDomain([])).toEqual([0, 1]);
    expect(
      trendDomain([
        { label: 'Mon', value: null },
        { label: 'Tue', value: NaN },
      ])
    ).toEqual([0, 1]);
    const [min, max] = trendDomain([
      { label: 'Mon', value: 80 },
      { label: 'Tue', value: null },
    ]);
    expect(min).toBeGreaterThan(79);
    expect(max).toBeLessThan(81);
    expect(min).toBeLessThan(80);
    expect(max).toBeGreaterThan(80);
    expect(trendDomain([{ label: 'Mon', value: 0 }])).toEqual([-1, 1]);
  });
});
