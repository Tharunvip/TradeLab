// TradeLab — Trade analysis & position size calculator
// Pure math exported + interactive state helpers for Analysis tab

export function computeAnalysis({ direction, entry, stop, t1, t2 = null, t3 = null, account = 100000, riskPct = 1, quantity = null }) {
  const LONG = String(direction).toUpperCase() === 'LONG';
  entry = +entry || 0; stop = +stop || 0; t1 = +t1 || 0; t2 = +t2 || 0; t3 = +t3 || 0;
  account = +account || 0; riskPct = +riskPct || 0;
  const riskPerUnit = Math.max(1e-9, Math.abs(entry - stop));
  const maxRisk = account * (riskPct / 100);
  const posSize = quantity ?? Math.max(0, maxRisk / riskPerUnit);
  const reward1 = LONG ? Math.abs(t1 - entry) : Math.abs(entry - t1);
  const rr1 = reward1 / riskPerUnit;
  const potentialLoss = posSize * riskPerUnit;
  const potentialProfitT1 = posSize * reward1;
  const profitT2 = t2 ? posSize * (LONG ? Math.abs(t2 - entry) : Math.abs(entry - t2)) : null;
  const profitT3 = t3 ? posSize * (LONG ? Math.abs(t3 - entry) : Math.abs(entry - t3)) : null;
  return {
    direction: LONG ? 'LONG' : 'SHORT',
    entry, stop, t1, t2, t3,
    account, riskPct,
    riskPerUnit: +riskPerUnit.toFixed(2),
    maxRisk: +maxRisk.toFixed(2),
    positionSize: +posSize.toFixed(3),
    rr: +rr1.toFixed(2),
    risk: +potentialLoss.toFixed(2),
    reward: +potentialProfitT1.toFixed(2),
    rewardT2: profitT2 != null ? +profitT2.toFixed(2) : null,
    rewardT3: profitT3 != null ? +profitT3.toFixed(2) : null,
  };
}

export function validateAnalysis({ entry, stop, t1, direction }) {
  const errors = [];
  if (!(entry > 0)) errors.push('Entry price must be > 0');
  if (!(stop > 0))  errors.push('Stop price must be > 0');
  if (!(t1 > 0))    errors.push('Target 1 price must be > 0');
  if (String(direction).toUpperCase() === 'LONG') {
    if (stop >= entry) errors.push('For LONG positions, Stop Loss must be below Entry');
    if (t1 <= entry)   errors.push('For LONG positions, Target must be above Entry');
  } else {
    if (stop <= entry) errors.push('For SHORT positions, Stop Loss must be above Entry');
    if (t1 >= entry)   errors.push('For SHORT positions, Target must be below Entry');
  }
  return errors;
}
