export function weightedCurrentScore(grades = []) {
  let count = 0;
  let total = 0;
  let credits = 0;
  let weightedTotal = 0;
  for (const grade of grades || []) {
    if (!Number.isFinite(grade?.score)) continue;
    count += 1;
    total += grade.score;
    const weight = Number(grade.credits);
    if (Number.isFinite(weight) && weight > 0) {
      credits += weight;
      weightedTotal += grade.score * weight;
    }
  }
  return count
    ? Math.round(credits > 0 ? weightedTotal / credits : total / count)
    : 0;
}
