import { allocateFefo, InsufficientLotQuantityError } from './fefo';

const now = new Date('2026-10-19T12:00:00Z');

describe('FEFO lot allocation', () => {
  const lots = [
    { id: 'later', quantity: 8, bestByDate: new Date('2027-03-01') },
    { id: 'expired', quantity: 20, bestByDate: new Date('2026-10-01') },
    { id: 'soon', quantity: 3, bestByDate: new Date('2026-11-01') },
    { id: 'empty', quantity: 0, bestByDate: new Date('2026-10-20') },
    { id: 'soon-b', quantity: 4, bestByDate: new Date('2026-11-01') },
  ];

  it('takes the soonest unexpired lots first and skips expired or empty lots', () => {
    expect(allocateFefo(lots, 5, now)).toEqual([
      { lotId: 'soon', take: 3 },
      { lotId: 'soon-b', take: 2 },
    ]);
  });

  it('does not mutate the input lots', () => {
    allocateFefo(lots, 1, now);
    expect(lots.find((lot) => lot.id === 'soon')?.quantity).toBe(3);
  });

  it('fails when unexpired quantity cannot cover the request', () => {
    expect(() => allocateFefo(lots, 16, now)).toThrow(InsufficientLotQuantityError);
  });
});
